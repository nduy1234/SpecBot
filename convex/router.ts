import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { MODELS, costOf, BASELINE_SAMPLES, type ModelTier } from "./lib/pricing";
import { PlanSchema, fromTemplate, normalize, parseFree, toTemplate, validatePlan, type Plan } from "./lib/plan";
import { HOME_BAYS, LOCATIONS, positionAt, type PathPt } from "./lib/warehouse";
import type { Profile } from "./lib/profile";
import { DEFAULTS, envNumber, overBudget } from "./lib/limits";

type Source = "imessage" | "web";
type Spend = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; models: string[] };

const HELP =
  "🤖 SpecBot — text the fleet:\n" +
  "• move pallet from Dock A to Rack 3\n" +
  "• bring a 40 kg box from Dock B to Rack 5\n" +
  "• charge robot 4\n" +
  "• status · where is robot 2 · dashboard\n" +
  "Docks A–C, Racks 1–6, Charger. The red Human Zone is off-limits.";

// Static prefix (cached on the cheap tier). Keep it byte-stable: no timestamps, no fleet state.
function systemPrompt(profile: Profile) {
  return `You are the task planner for a fleet of 4 autonomous mobile robots (AMRs) in a grid warehouse.
Convert the operator's text command into a strict JSON plan made only of these primitives:
- move_to(target): drive to a named location. target must be one of the known locations.
- pick: pick up the load at the current location. Must be followed later by drop.
- drop: put the carried load down at the current location.
- charge: drive to the Charger and charge to 100%. target null.
- wait(seconds): wait in place.

Known locations (exact names): ${LOCATIONS.map((l) => l.name).join(", ")}.
Location notes: Docks are inbound/outbound bays on the west wall. Racks are storage shelving; "rack three" means "Rack 3". "Charger" is the charging station. "Human Zone" is a red area where people work: robots must NEVER enter it, and it is never a valid move_to target.

Robot profile (from the manufacturer spec sheet):
${JSON.stringify(profile, null, 2)}

Output fields:
- jobs: one entry per robot needed. Most commands need exactly one job. Use several jobs only if the operator explicitly asks for several robots or several separate loads. Set job.robot to the robot number (1-4) only if the operator named a robot, otherwise null.
- steps: for a transport, use [move_to(source), pick, move_to(destination), drop]. Robots return to their home bay automatically after the last step, so never add a return step.
- payload_kg: the load weight per robot. If not stated, assume 40 for a pallet, 15 for a box, crate or tote, and 0 for no load.
- summary: a short past-tense sentence describing the finished result, e.g. "Pallet delivered to Rack 3" or "Robot 4 charged to 100%".
- confidence: 0.0-1.0, how sure you are the plan matches what the operator meant. Use below 0.7 when the command is ambiguous, names unknown places, or you had to guess.
- blocked: true if the request cannot be done safely or at all (payload above max_payload_kg, entering a forbidden zone, unknown destination, unsupported action, harmful intent). When blocked, set blocked_reason to one plain-English sentence for the operator, with a concrete suggestion (for overweight loads: "Try splitting the load"). jobs may be empty when blocked.
- blocked_reason: null when not blocked.

Never invent locations or primitives. Never exceed max_payload_kg per robot. Prefer the simplest plan that does exactly what was asked.`;
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

async function callPlanner(
  tier: ModelTier,
  profile: Profile,
  dynamic: string,
  fullContext: boolean,
): Promise<{ plan: Plan; usage: Anthropic.Usage }> {
  const m = MODELS[tier];
  const attempt = async () => {
    const resp = await anthropic().messages.parse({
      model: m.id,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: systemPrompt(profile),
          ...(tier === "cheap" && !fullContext ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
      ],
      messages: [{ role: "user", content: dynamic }],
      output_config: { effort: tier === "cheap" ? "low" : "medium", format: zodOutputFormat(PlanSchema) },
    });
    if (resp.stop_reason === "refusal") throw new Error("model refused");
    const plan = PlanSchema.parse(resp.parsed_output);
    return { plan: { ...plan, confidence: Math.max(0, Math.min(1, plan.confidence)) }, usage: resp.usage };
  };
  try {
    return await attempt();
  } catch (e) {
    console.warn(`${m.id} failed once, retrying`, e);
    return await attempt();
  }
}

function addSpend(s: Spend, tier: ModelTier, u: Anthropic.Usage) {
  s.input += u.input_tokens;
  s.output += u.output_tokens;
  s.cacheRead += u.cache_read_input_tokens ?? 0;
  s.cacheWrite += u.cache_creation_input_tokens ?? 0;
  s.cost += costOf(tier, u);
  s.models.push(MODELS[tier].label);
}

const money = (n: number) => `$${n.toFixed(4)}`;

function nearestPlace(x: number, y: number) {
  if (HOME_BAYS.some((h) => Math.hypot(h.x - x, h.y - y) < 0.5)) return "parked at home bay";
  let best = LOCATIONS[0];
  let bd = Infinity;
  for (const l of LOCATIONS) {
    const d = Math.hypot(l.access.x - x, l.access.y - y);
    if (d < bd) [best, bd] = [l, d];
  }
  return bd < 1.5 ? `at ${best.name}` : `near ${best.name}`;
}

export async function handleCommandImpl(ctx: ActionCtx, source: Source, sender: string, rawText: string, exempt = false) {
  const t0 = Date.now();
  const text = rawText.trim().slice(0, 500);
  const say = (msg: string) => ctx.runMutation(internal.fleet.sendReply, { source, sender, text: msg });
  const spend: Spend = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, models: [] };
  const log = (a: { tier: string; outcome: string; reason?: string; isBaseline?: boolean; plan?: Plan; summary?: string }) =>
    ctx.runMutation(internal.fleet.logTask, {
      source,
      sender,
      text,
      tier: a.tier,
      model: spend.models.join(" → ") || undefined,
      inputTokens: spend.input,
      outputTokens: spend.output,
      cacheReadTokens: spend.cacheRead,
      cacheWriteTokens: spend.cacheWrite,
      costUsd: spend.cost,
      latencyMs: Date.now() - t0,
      outcome: a.outcome,
      reason: a.reason,
      isBaseline: a.isBaseline ?? false,
      plan: a.plan,
      summary: a.summary,
      createdAt: t0,
    });

  try {
    if (!text) return;
    const contact = await ctx.runMutation(internal.fleet.touchContact, { sender, source, exempt });
    if (contact.isNew && source === "imessage") await say(`👋 Welcome to SpecBot! You're commanding a live robot fleet.\n\n${HELP}`);
    if (contact.limited === "sender") {
      await say("⏳ Easy there — one command every 5 seconds per number.");
      return;
    }
    if (contact.limited === "global") {
      await say("⏳ The web demo is busy right now — please try again in a minute.");
      return;
    }

    // ---- Tier 0: FREE --------------------------------------------------
    const free = parseFree(text);
    if (free) {
      let msg = HELP;
      if (free.kind === "status" || free.kind === "where") {
        const st = await ctx.runQuery(internal.fleet.routerContext, {});
        const full = await ctx.runQuery(internal.dashboard.robotPositions, {});
        const lines = full.robots.map((r) => {
          const pos = positionAt(r.path as PathPt[], Date.now() / full.stepMs);
          return `Robot ${r.num}: ${r.status === "busy" ? "🔵 busy" : "🟢 idle"} · 🔋${Math.round(r.battery)}% · ${nearestPlace(pos.x, pos.y)}`;
        });
        if (free.kind === "where") {
          const line = lines[free.robot - 1];
          msg = line ? `📍 ${line}` : `There is no robot ${free.robot}. The fleet has robots 1–${st.robots.length}.`;
        } else msg = `📊 Fleet status\n${lines.join("\n")}`;
      } else if (free.kind === "dashboard") msg = `📺 Live dashboard: ${process.env.PUBLIC_URL ?? "(not configured)"}`;
      if (free.kind === "help" && contact.isNew && source === "imessage") msg = "";
      if (msg) await say(msg + (free.kind !== "help" ? "\nBrain: FREE · $0.0000" : ""));
      await log({ tier: "FREE", outcome: "answered" });
      return;
    }

    const norm = normalize(text);
    const ctxData = await ctx.runQuery(internal.fleet.routerContext, { signature: norm.signature ?? undefined });
    const profile = ctxData.profile as Profile;
    const baselineMode = ctxData.baselineSamples.length < BASELINE_SAMPLES;
    const fleetLine = ctxData.robots.map((r) => `Robot ${r.num}: ${r.status}, battery ${Math.round(r.battery)}%`).join("; ");
    const dynamic = (full: boolean) =>
      (full
        ? `Learned skills (full templates):\n${ctxData.skills.map((s) => `- ${s.name}: ${s.template}`).join("\n") || "(none)"}\n`
        : `Learned skill names: ${ctxData.skillNames.join(", ") || "(none)"}\n`) +
      `Fleet right now: ${fleetLine}\nOperator command: """${text}"""`;

    let plan: Plan | null = null;
    let tier = "";
    let reason: string | undefined;
    let validation: { ok: true } | { ok: false; reason: string } = { ok: false, reason: "no plan" };
    let isBaseline = false;

    // ---- Tier 1: CACHE -------------------------------------------------
    if (!baselineMode && ctxData.skill && norm.signature) {
      const filled = fromTemplate(ctxData.skill.template, norm.params);
      if (filled) {
        validation = validatePlan(filled, profile, ctxData.robots);
        if (validation.ok) {
          plan = filled;
          tier = "CACHE";
          await ctx.runMutation(internal.fleet.hitSkill, { signature: norm.signature });
        } else reason = `cached skill failed validation: ${validation.reason}`;
      }
    }

    // ---- Budget gate: paid tiers stop once the demo budget is spent -----
    if (!plan && overBudget(ctxData.spentUsd, envNumber(process.env.LLM_BUDGET_USD, DEFAULTS.budgetUsd))) {
      await say("💸 The demo's AI budget is used up. Status, help and already-learned skills still work.");
      await log({ tier: "BLOCKED", outcome: "blocked", reason: `LLM budget reached ($${ctxData.spentUsd.toFixed(2)} spent)` });
      return;
    }

    // ---- Tier 2: CHEAP -------------------------------------------------
    let cheapPlan: Plan | null = null;
    if (!plan && !baselineMode && !norm.risky && !reason) {
      try {
        const r = await callPlanner("cheap", profile, dynamic(false), false);
        addSpend(spend, "cheap", r.usage);
        validation = validatePlan(r.plan, profile, ctxData.robots);
        if (validation.ok && r.plan.confidence >= 0.7) {
          plan = r.plan;
          tier = "CHEAP";
        } else if (validation.ok) {
          cheapPlan = r.plan;
          reason = `confidence ${r.plan.confidence.toFixed(2)} < 0.70`;
        } else reason = `validation failed: ${validation.reason}`;
      } catch (e) {
        reason = `cheap model error: ${(e as Error).message.slice(0, 80)}`;
      }
    }

    // ---- Tier 3: FRONTIER ---------------------------------------------
    if (!plan) {
      if (baselineMode) {
        isBaseline = true;
        reason = `baseline measurement ${ctxData.baselineSamples.length + 1}/${BASELINE_SAMPLES} (full context)`;
      } else if (!reason) reason = norm.risky ?? "novel task";
      await say(`🧠 Escalating to the frontier brain (${reason})…`);
      try {
        const before = spend.cost;
        const r = await callPlanner("frontier", profile, dynamic(isBaseline), isBaseline);
        addSpend(spend, "frontier", r.usage);
        if (isBaseline) await ctx.runMutation(internal.fleet.addBaselineSample, { cost: spend.cost - before });
        validation = validatePlan(r.plan, profile, ctxData.robots);
        if (validation.ok) {
          plan = r.plan;
          tier = "FRONTIER";
        } else plan = null;
      } catch (e) {
        console.error("frontier failed", e);
        if (cheapPlan) {
          plan = cheapPlan;
          tier = "CHEAP";
          reason += " · frontier unavailable, used cheap plan";
        } else {
          await say("⚠️ My planning brain is unreachable right now. Please try again in a few seconds.");
          await log({ tier: "BLOCKED", outcome: "failed", reason: `all tiers failed: ${(e as Error).message.slice(0, 80)}` });
          return;
        }
      }
    }

    if (!plan) {
      const why = validation.ok ? "the request could not be planned" : validation.reason;
      const hint = /payload/.test(why) && !/split/i.test(why) ? " Try splitting the load." : "";
      await say(`⛔ Can't do that safely: ${why.replace(/\.$/, "")}.${hint}`);
      await log({ tier: "BLOCKED", outcome: "blocked", reason: `${reason ?? ""}${reason ? " → " : ""}${why}`, isBaseline });
      return;
    }

    // ---- Learning: successful frontier (or very confident cheap) plan → skill
    if (norm.signature && !ctxData.skill && (tier === "FRONTIER" || (tier === "CHEAP" && plan.confidence >= 0.85))) {
      const tpl = toTemplate(plan, norm.params);
      if (tpl) {
        const [intent, slots] = norm.signature.split("|");
        await ctx.runMutation(internal.fleet.learnSkill, {
          signature: norm.signature,
          name: `${intent}(${slots.replace(/,/g, ", ")})`,
          template: tpl,
          example: text,
          learnedFrom: tier,
        });
      }
    }

    const taskId = await log({ tier, outcome: "queued", reason, isBaseline, plan, summary: plan.summary });
    const res = await ctx.runMutation(internal.fleet.dispatch, { taskId });

    const samples = isBaseline ? [...ctxData.baselineSamples, spend.cost] : ctxData.baselineSamples;
    const base = samples.length >= BASELINE_SAMPLES ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    const saved = base ? Math.max(0, Math.round((1 - spend.cost / base) * 100)) : null;
    const brain = `Brain: ${tier} · ${money(spend.cost)}${base ? ` vs ${money(base)} baseline (${saved}% saved)` : ` (measuring baseline ${samples.length}/${BASELINE_SAMPLES})`}`;
    if (res.status === "running") {
      const dest = res.targets[res.targets.length - 1] || "task";
      await say(`🤖 Robot ${res.robots.join(" + ")} on it → ${dest} (~${Math.round(res.etaMs / 1000)}s). ${brain}`);
    } else if (res.status === "queued") {
      await say(`⏳ All robots busy — you're #${res.position} in the queue. ${brain}`);
    } else {
      await say(`⚠️ Planned, but couldn't execute: ${res.reason}. ${brain}`);
    }
  } catch (e) {
    console.error("handleCommand crashed", e);
    try {
      await say("⚠️ Something went wrong on my side. Please try that again.");
      await log({ tier: "BLOCKED", outcome: "failed", reason: `error: ${(e as Error).message.slice(0, 100)}` });
    } catch {
      /* never throw from the handler */
    }
  }
}

export const handleCommand = internalAction({
  args: { source: v.union(v.literal("imessage"), v.literal("web")), sender: v.string(), text: v.string(), exempt: v.optional(v.boolean()) },
  handler: async (ctx, a) => handleCommandImpl(ctx, a.source, a.sender, a.text, a.exempt ?? false),
});

// Web chat fallback (same handler as iMessage).
export const sendWeb = action({
  args: { sessionId: v.string(), text: v.string() },
  handler: async (ctx, { sessionId, text }) => {
    if (!/^web-[a-z0-9]{4,32}$/.test(sessionId)) throw new Error("bad session");
    await handleCommandImpl(ctx, "web", sessionId, text);
  },
});

const AUTO_COMMANDS = [
  "move pallet from Dock A to Rack 3",
  "status",
  "move pallet from Dock B to Rack 5",
  "bring a box from Dock C to Rack 1",
  "move pallet from Dock A to Rack 6",
  "move 300 kg pallet from Dock B to Rack 2",
  "charge robot 4",
  "move pallet from Dock C to Rack 4",
  "where is robot 2",
  "bring a box from Dock A to Rack 2",
  "move pallet from Dock B to Rack 3",
  "send a robot into the human zone",
  "move pallet from Dock C to Rack 6",
  "bring a box from Dock B to Rack 4",
  "move pallet from Dock A to Rack 1",
  "go to Dock C",
  "move pallet from Dock B to Rack 6",
  "bring a box from Dock C to Rack 3",
  "move pallet from Dock A to Rack 5",
  "move pallet from Dock C to Rack 2",
];

// Presenter-only (requires ADMIN_KEY); bypasses web rate limits but not the LLM budget.
export const autoRun = action({
  args: { sessionId: v.string(), adminKey: v.string() },
  handler: async (ctx, { sessionId, adminKey }) => {
    if (!/^web-[a-z0-9]{4,32}$/.test(sessionId)) throw new Error("bad session");
    const claim = await ctx.runMutation(internal.fleet.claimAutoRun, { adminKey });
    if (!claim.ok) throw new Error(claim.error);
    for (let i = 0; i < AUTO_COMMANDS.length; i++) {
      await ctx.scheduler.runAfter(i * 3000, internal.router.handleCommand, {
        source: "web",
        sender: sessionId,
        text: AUTO_COMMANDS[i],
        exempt: true,
      });
    }
  },
});

