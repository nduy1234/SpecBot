"use node";
// handleCommand(source, sender, text): the one entry point for iMessage, web chat and auto-run.
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deliver } from "./photon";
import { plan as llmPlan, LlmError, type LlmResult } from "./lib/llm";
import { cheapPrefix, dynamicContext, frontierPrefix } from "./lib/prompts";
import { BASELINE_SAMPLES, type Usage } from "../shared/pricing";
import { FALLBACK_PROFILE } from "../shared/fallbackProfile";
import { fillTemplate, normalize, parameterize, riskSignals } from "../shared/normalize";
import { LOCATIONS } from "../shared/layout";
import { ProfileSchema, type Plan, type Profile } from "../shared/types";
import { validatePlan } from "../shared/validator";

const HELP = `🤖 SpecBot here: I command a 4-robot warehouse fleet.
Try:
• move pallet from Dock A to Rack 3
• bring 40 kg boxes from Rack 5 to Dock C
• charge robot 2
• where is robot 1 / status / dashboard
Every reply shows which brain planned it and what it cost vs an all-Opus baseline.`;

const source = v.union(v.literal("imessage"), v.literal("web"), v.literal("autorun"));
type Args = { source: "imessage" | "web" | "autorun"; senderKey: string; spaceId?: string; agentId?: string; text: string };

export const handleCommand = internalAction({
  args: { source, senderKey: v.string(), spaceId: v.optional(v.string()), agentId: v.optional(v.string()), text: v.string() },
  handler: async (ctx, a) => run(ctx, a),
});

export const webCommand = action({
  args: { text: v.string(), session: v.string() },
  handler: async (ctx, { text, session }) => {
    if (!text.trim() || text.length > 280 || session.length > 64) return;
    await run(ctx, { source: "web", senderKey: session, text });
  },
});

const DEMO = [
  "move pallet from Dock A to Rack 3",
  "move pallet from Dock B to Rack 1",
  "where is robot 2",
  "move boxes from Rack 4 to Dock C",
  "move pallet from Dock C to Rack 6",
  "send robot 3 to Dock A",
  "move pallet from Rack 2 to Dock B",
  "bring 300 kg of steel from Dock A to Rack 5",
  "move tires from Dock B to Rack 2",
  "status",
  "move pallet from Dock A to Rack 4",
  "deliver crates from Rack 6 to Dock A",
  "charge robot 4",
  "move pallet from Dock C to Rack 1",
  "drive robot 1 through the human zone to Dock C",
  "move pallet from Dock B to Rack 5",
  "move boxes from Rack 3 to Dock B",
  "move pallet from Dock A to Rack 2",
  "use two robots to move 150 kg of parts from Dock C to Rack 6",
  "move pallet from Dock B to Rack 3",
];

export const autorun = action({
  args: {},
  handler: async (ctx): Promise<{ started: boolean; queued: number }> => {
    // Avoid flooding the queue when Auto-run is pressed repeatedly.
    const queued: number = await ctx.runQuery(internal.tasks.queuedCount, {});
    if (queued > 4) return { started: false, queued };
    for (let i = 0; i < DEMO.length; i++)
      await ctx.scheduler.runAfter(i * 2500, internal.router.handleCommand, { source: "autorun", senderKey: "autorun", text: DEMO[i] });
    return { started: true, queued };
  },
});

// ---------------------------------------------------------------------------

function tier0(text: string, robots: Doc<"robots">[]): string | null {
  const t = text.toLowerCase().trim().replace(/[!.?]+$/, "");
  const site = process.env.SITE_URL ?? "";
  if (/^(help|commands|menu|hi|hello|hey|start|\?)$/.test(t)) return HELP;
  if (/^(dashboard|link|watch|site|url)$/.test(t)) return `📺 Live dashboard: ${site}`;
  const now = Date.now();
  const where = t.match(/where(?:'s| is)?\s+(?:robot|r|bot)\s*#?\s*(\d)/);
  if (where) {
    const r = robots.find((x) => x.num === Number(where[1]));
    if (!r) return `There's no robot ${where[1]}: the fleet is robots 1–4.`;
    const busy = r.busyUntil > now;
    const near = Object.entries(LOCATIONS).sort(
      ([, a], [, b]) => Math.abs(a.access.x - r.cell.x) + Math.abs(a.access.y - r.cell.y) - (Math.abs(b.access.x - r.cell.x) + Math.abs(b.access.y - r.cell.y)),
    )[0][0];
    return `📍 Robot ${r.num} is ${busy ? `busy, headed for cell (${r.cell.x},${r.cell.y}) near ${near}` : `idle at its home bay`}. Battery ${Math.round(r.battery)}%.`;
  }
  if (/^(status|fleet|fleet status|robots)$/.test(t))
    return `🚦 Fleet: ${robots.map((r) => `R${r.num} ${r.busyUntil > now ? "busy" : "idle"} ${Math.round(r.battery)}%`).join(" · ")}`;
  return null;
}

const money = (x: number) => `$${x.toFixed(4)}`;

async function run(ctx: ActionCtx, a: Args) {
  const t0 = Date.now();
  const begin = await ctx.runMutation(internal.tasks.begin, { source: a.source, senderKey: a.senderKey, spaceId: a.spaceId, agentId: a.agentId });
  const contactId = begin.contactId as Id<"contacts">;
  if (begin.limited) {
    await deliver(ctx, { contactId, text: "⏳ One command every 5 seconds, please. Try again in a moment." });
    return;
  }
  const text = a.text.trim().slice(0, 280);
  const c = await ctx.runQuery(internal.tasks.context, {});
  const robots = c.robots;

  const taskId = await ctx.runMutation(internal.tasks.create, {
    source: a.source,
    senderKey: a.senderKey,
    contactId,
    text,
    tier: "PENDING",
    status: "planning",
  });

  try {
    const free = tier0(text, robots);
    if (free || (begin.isNew && a.source === "imessage" && /^(hi|hello|hey|start)$/i.test(text))) {
      const reply = free ?? HELP;
      await ctx.runMutation(internal.tasks.patch, { id: taskId, fields: { tier: "FREE", status: "answered", latencyMs: Date.now() - t0 } });
      await deliver(ctx, { contactId, taskId, text: reply });
      return;
    }
    if (begin.isNew && a.source === "imessage") await deliver(ctx, { contactId, text: HELP });

    const profileDoc = c.profile;
    const parsedProfile = ProfileSchema.safeParse(profileDoc?.data);
    const profile: Profile = parsedProfile.success ? parsedProfile.data : FALLBACK_PROFILE;
    const robotStates = robots.map((r) => ({ num: r.num, battery: r.battery }));
    const samples = c.metrics?.baselineSamples ?? [];
    const baselinePhase = samples.length < BASELINE_SAMPLES;

    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let cost = 0;
    const add = (u: Usage, x: number) => {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cacheReadTokens += u.cacheReadTokens;
      usage.cacheWriteTokens += u.cacheWriteTokens;
      cost += x;
    };
    const reasons: string[] = [];
    let chosen: Plan | null = null;
    let tier = "";
    let model: string | undefined;
    let blockedReason: string | null = null;
    let baselineCost: number | null = null;

    const intent = normalize(text);
    const risks = riskSignals(text);

    // Tier 1: CACHE
    if (intent && !risks.length) {
      const skill = c.skills.find((s) => s.key === intent.key);
      if (skill) {
        const p = fillTemplate(skill.template, intent);
        const verdict = validatePlan(p, profile, robotStates);
        if (verdict.ok) {
          chosen = p;
          tier = "CACHE";
          await ctx.runMutation(internal.tasks.bumpSkill, { id: skill._id });
        } else reasons.push(`cached skill failed validation: ${verdict.reason}`);
      }
    }

    // Tier 2: CHEAP
    if (!chosen && !baselinePhase && !risks.length && !reasons.length) {
      try {
        const r: LlmResult = await llmPlan("cheap", cheapPrefix(profile), dynamicContext(robots, c.skills, false), text);
        add(r.usage, r.cost);
        model = r.model;
        const verdict = validatePlan(r.plan, profile, robotStates);
        if (r.plan.confidence < 0.7) reasons.push(`low confidence (${r.plan.confidence.toFixed(2)})`);
        if (r.plan.risky) reasons.push("cheap model flagged it risky");
        if (!verdict.ok) reasons.push(`validator: ${verdict.reason}`);
        if (!reasons.length) {
          chosen = r.plan;
          tier = "CHEAP";
        }
      } catch (e) {
        if (e instanceof LlmError) add(e.usage, e.cost);
        reasons.push("cheap model failed, falling back");
      }
    }

    // Tier 3: FRONTIER
    if (!chosen) {
      if (baselinePhase) reasons.unshift(`baseline sample ${samples.length + 1}/${BASELINE_SAMPLES} (all-frontier, full context)`);
      for (const r of risks) reasons.push(`risky: ${r}`);
      try {
        const r = await llmPlan("frontier", frontierPrefix(profile, profileDoc?.excerpt), dynamicContext(robots, c.skills, true, reasons), text);
        add(r.usage, r.cost);
        model = r.model;
        if (baselinePhase) baselineCost = r.cost;
        const verdict = validatePlan(r.plan, profile, robotStates);
        if (verdict.ok) {
          chosen = r.plan;
          tier = "FRONTIER";
        } else blockedReason = verdict.reason;
      } catch (e) {
        if (e instanceof LlmError) add(e.usage, e.cost);
        blockedReason = "my planning brain is unavailable right now. Please try again in a few seconds.";
      }
    }

    if (baselineCost != null) await ctx.runMutation(internal.tasks.recordBaseline, { cost: baselineCost });
    const fields = {
      model,
      ...usage,
      costUsd: cost,
      latencyMs: Date.now() - t0,
      reasons,
      plan: chosen ?? undefined,
      baselineSample: baselineCost != null,
    };

    if (!chosen) {
      await ctx.runMutation(internal.tasks.patch, { id: taskId, fields: { ...fields, tier: "BLOCKED", status: "blocked", reasons: [...reasons, blockedReason ?? ""] } });
      await deliver(ctx, { contactId, taskId, text: `⛔ Can't do that safely: ${blockedReason}` });
      return;
    }

    // Learning: successful frontier (or very confident cheap) plans become parameterized skills.
    if (intent && !risks.length && (tier === "FRONTIER" || (tier === "CHEAP" && chosen.confidence >= 0.85))) {
      const tpl = parameterize(chosen, intent);
      if (tpl) await ctx.runMutation(internal.tasks.learnSkill, { key: intent.key, template: tpl, example: text, learnedFrom: tier });
    }

    await ctx.runMutation(internal.tasks.patch, { id: taskId, fields: { ...fields, tier } });
    const res = await ctx.runMutation(internal.sim.dispatch, { taskId });

    const stats = await ctx.runQuery(internal.tasks.context, {});
    const s2 = stats.metrics?.baselineSamples ?? [];
    const base = s2.length ? s2.reduce((x, y) => x + y, 0) / s2.length : null;
    const brain =
      base != null && s2.length >= BASELINE_SAMPLES
        ? `Brain: ${tier} · ${money(cost)} vs ${money(base)} baseline (${Math.max(0, Math.round((1 - cost / base) * 100))}% saved)`
        : `Brain: ${tier} · ${money(cost)} (measuring baseline ${s2.length}/${BASELINE_SAMPLES})`;

    if (res.status === "running") {
      const eta = Math.max(1, Math.round((res.etaAt - Date.now()) / 1000));
      const who = res.robotNums.length > 1 ? `Robots ${res.robotNums.join(" + ")}` : `Robot ${res.robotNums[0]}`;
      await deliver(ctx, { contactId, taskId, text: `🤖 ${who} on it → ${res.target} (~${eta}s). ${brain}` });
    } else if (res.status === "queued") {
      await deliver(ctx, { contactId, taskId, text: `🕐 All robots are busy. You're #${res.position} in line. ${brain}` });
    } else {
      await ctx.runMutation(internal.tasks.patch, { id: taskId, fields: { tier: "BLOCKED", status: "blocked", reasons: [...reasons, res.reason] } });
      await deliver(ctx, { contactId, taskId, text: `⛔ Can't do that safely: ${res.reason}` });
    }
  } catch (e) {
    console.error("handleCommand failed", e);
    await ctx.runMutation(internal.tasks.patch, { id: taskId, fields: { tier: "BLOCKED", status: "blocked", reasons: [`internal error: ${String(e).slice(0, 120)}`] } });
    await deliver(ctx, { contactId, taskId, text: "⚠️ Something glitched on my side. Please send that again." });
  }
}

