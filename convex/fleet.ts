import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { BATTERY_PER_CELL, HOME_BAYS, executeJob, type PathPt, type PlanStep } from "./lib/warehouse";
import { FALLBACK_PROFILE, stepMsFor, type Profile } from "./lib/profile";
import type { Plan } from "./lib/plan";

const START_BATTERY = [92, 78, 64, 31];

export async function getProfile(ctx: QueryCtx): Promise<{ data: Profile; source: string; url?: string }> {
  const p = await ctx.db.query("profile").order("desc").first();
  return p ? { data: p.data as Profile, source: p.source, url: p.url } : { data: FALLBACK_PROFILE, source: "fallback" };
}

export function maskSender(source: string, sender: string) {
  const digits = sender.replace(/\D/g, "");
  if (source === "imessage") return `•••• ${digits.slice(-4) || sender.slice(-4)}`;
  return `web·${sender.slice(-4)}`;
}

async function seed(ctx: MutationCtx) {
  const existing = await ctx.db.query("robots").collect();
  if (existing.length) return;
  for (let i = 0; i < 4; i++) {
    const h = HOME_BAYS[i];
    await ctx.db.insert("robots", {
      num: i + 1,
      status: "idle",
      battery: START_BATTERY[i],
      home: h,
      path: [[h.x, h.y, 0]],
      events: [],
    });
  }
}

export const init = mutation({
  args: {},
  handler: async (ctx) => {
    await seed(ctx);
    return Date.now();
  },
});

// Client clock sync: browsers animate against server time.
export const ping = mutation({ args: {}, handler: async () => Date.now() });

export const state = query({
  args: {},
  handler: async (ctx) => {
    const robots = await ctx.db.query("robots").withIndex("by_num").collect();
    const profile = await getProfile(ctx);
    return {
      robots: robots.map((r) => ({
        num: r.num,
        status: r.status,
        battery: r.battery,
        path: r.path,
        events: r.events,
      })),
      stepMs: stepMsFor(profile.data),
      profile,
    };
  },
});

// ---- Router support -----------------------------------------------------
export const routerContext = internalQuery({
  args: { signature: v.optional(v.string()) },
  handler: async (ctx, { signature }) => {
    const robots = await ctx.db.query("robots").withIndex("by_num").collect();
    const profile = await getProfile(ctx);
    const skills = await ctx.db.query("skills").collect();
    const baseline = await ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "baseline")).first();
    const skill = signature ? skills.find((s) => s.signature === signature) ?? null : null;
    return {
      profile: profile.data,
      robots: robots.map((r) => ({ num: r.num, battery: r.battery, status: r.status })),
      skillNames: skills.map((s) => s.name),
      skills: skills.map((s) => ({ name: s.name, template: s.template })),
      skill,
      baselineSamples: baseline?.samples ?? [],
    };
  },
});

export const touchContact = internalMutation({
  args: { sender: v.string(), source: v.string(), exempt: v.boolean() },
  handler: async (ctx, { sender, source, exempt }) => {
    const now = Date.now();
    const c = await ctx.db.query("contacts").withIndex("by_sender", (q) => q.eq("sender", sender)).first();
    if (!c) {
      await ctx.db.insert("contacts", { sender, source, lastCommandAt: now, count: 1 });
      return { isNew: true, limited: false };
    }
    if (!exempt && now - c.lastCommandAt < 5000) return { isNew: false, limited: true };
    await ctx.db.patch(c._id, { lastCommandAt: now, count: c.count + 1 });
    return { isNew: false, limited: false };
  },
});

export const markInbound = internalMutation({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const seen = await ctx.db.query("inbound").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).first();
    if (seen) return false;
    await ctx.db.insert("inbound", { messageId });
    return true;
  },
});

async function reply(ctx: MutationCtx, source: string, sender: string, text: string) {
  await ctx.db.insert("outbox", { sender, source, text, createdAt: Date.now() });
  if (source === "imessage") await ctx.scheduler.runAfter(0, internal.imessage.send, { to: sender, text });
}

export const sendReply = internalMutation({
  args: { source: v.string(), sender: v.string(), text: v.string() },
  handler: async (ctx, a) => reply(ctx, a.source, a.sender, a.text),
});

export const addBaselineSample = internalMutation({
  args: { cost: v.number() },
  handler: async (ctx, { cost }) => {
    const m = await ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "baseline")).first();
    if (!m) await ctx.db.insert("metrics", { key: "baseline", samples: [cost] });
    else await ctx.db.patch(m._id, { samples: [...m.samples, cost] });
  },
});

export const learnSkill = internalMutation({
  args: { signature: v.string(), name: v.string(), template: v.string(), example: v.string(), learnedFrom: v.string() },
  handler: async (ctx, a) => {
    const ex = await ctx.db.query("skills").withIndex("by_signature", (q) => q.eq("signature", a.signature)).first();
    if (ex) return;
    await ctx.db.insert("skills", { ...a, hits: 0, createdAt: Date.now() });
  },
});

export const hitSkill = internalMutation({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    const s = await ctx.db.query("skills").withIndex("by_signature", (q) => q.eq("signature", signature)).first();
    if (s) await ctx.db.patch(s._id, { hits: s.hits + 1 });
  },
});

export const logTask = internalMutation({
  args: {
    source: v.union(v.literal("imessage"), v.literal("web")),
    sender: v.string(),
    text: v.string(),
    tier: v.string(),
    model: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    outcome: v.string(),
    reason: v.optional(v.string()),
    isBaseline: v.boolean(),
    plan: v.optional(v.any()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    return await ctx.db.insert("tasks", {
      ...a,
      senderMasked: maskSender(a.source, a.sender),
      robotNums: [],
      pendingJobs: 0,
      createdAt: Date.now(),
    });
  },
});

// ---- Dispatch -------------------------------------------------------------
type DispatchResult =
  | { status: "running"; robots: number[]; etaMs: number; targets: string[] }
  | { status: "queued"; position: number }
  | { status: "failed"; reason: string };

async function tryDispatch(ctx: MutationCtx, taskId: Id<"tasks">): Promise<DispatchResult> {
  const task = (await ctx.db.get(taskId))!;
  const plan = task.plan as Plan;
  const profile = await getProfile(ctx);
  const stepMs = stepMsFor(profile.data);
  const now = Date.now();
  const s0 = Math.ceil(now / stepMs) + 1;
  const robots = await ctx.db.query("robots").withIndex("by_num").collect();

  // assign robots: named robot first, otherwise idle robot with most battery
  const assigned: Doc<"robots">[] = [];
  for (const job of plan.jobs) {
    let r: Doc<"robots"> | undefined;
    if (job.robot !== null) r = robots.find((x) => x.num === job.robot && x.status === "idle" && !assigned.includes(x));
    else
      r = robots
        .filter((x) => x.status === "idle" && !assigned.includes(x))
        .sort((a, b) => b.battery - a.battery)[0];
    if (!r) {
      if (task.outcome !== "queued") await ctx.db.patch(taskId, { outcome: "queued" });
      const queued = await ctx.db.query("tasks").withIndex("by_outcome", (q) => q.eq("outcome", "queued")).collect();
      return { status: "queued", position: queued.findIndex((t) => t._id === taskId) + 1 || queued.length };
    }
    assigned.push(r);
  }

  const others = robots.filter((r) => !assigned.includes(r)).map((r) => ({ path: r.path as PathPt[] }));
  const planned: { robot: Doc<"robots">; path: PathPt[]; events: { step: number; type: string }[]; endStep: number; battery: number }[] = [];
  for (let i = 0; i < plan.jobs.length; i++) {
    const r = assigned[i];
    const last = r.path[r.path.length - 1];
    const res = executeJob(plan.jobs[i].steps as PlanStep[], { x: last[0], y: last[1] }, r.home, s0, others, stepMs);
    if (!res.ok) {
      await ctx.db.patch(taskId, { outcome: "failed", reason: res.reason });
      return { status: "failed", reason: res.reason };
    }
    others.push({ path: res.path });
    const battery = res.charged ? 100 : Math.max(0, r.battery - res.cellsMoved * BATTERY_PER_CELL);
    planned.push({ robot: r, path: res.path, events: res.events, endStep: res.endStep, battery });
  }

  let maxEnd = s0;
  for (const p of planned) {
    await ctx.db.patch(p.robot._id, {
      status: "busy",
      path: p.path,
      events: p.events,
      taskId,
      batteryAfter: p.battery,
    });
    maxEnd = Math.max(maxEnd, p.endStep);
    await ctx.scheduler.runAt(p.endStep * stepMs, internal.fleet.completeJob, { taskId, robotNum: p.robot.num });
  }
  await ctx.db.patch(taskId, {
    outcome: "running",
    robotNums: planned.map((p) => p.robot.num),
    pendingJobs: planned.length,
  });
  const targets = plan.jobs.flatMap((j) => j.steps.filter((s) => s.action === "move_to").map((s) => s.target ?? ""));
  return { status: "running", robots: planned.map((p) => p.robot.num), etaMs: maxEnd * stepMs - now, targets };
}

export const dispatch = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => tryDispatch(ctx, taskId),
});

export const completeJob = internalMutation({
  args: { taskId: v.id("tasks"), robotNum: v.number() },
  handler: async (ctx, { taskId, robotNum }) => {
    const r = await ctx.db.query("robots").withIndex("by_num", (q) => q.eq("num", robotNum)).first();
    if (r && r.taskId === taskId) {
      const last = r.path[r.path.length - 1];
      await ctx.db.patch(r._id, {
        status: "idle",
        battery: r.batteryAfter ?? r.battery,
        path: [last],
        events: [],
        taskId: undefined,
        batteryAfter: undefined,
      });
    }
    const task = await ctx.db.get(taskId);
    if (task && task.outcome === "running") {
      const pending = task.pendingJobs - 1;
      if (pending <= 0) {
        await ctx.db.patch(taskId, { pendingJobs: 0, outcome: "done", doneAt: Date.now() });
        const url = process.env.PUBLIC_URL ?? "";
        await reply(ctx, task.source, task.sender, `✅ Done. ${task.summary ?? "Task complete"}.${url ? ` Watch live: ${url}` : ""}`);
      } else await ctx.db.patch(taskId, { pendingJobs: pending });
    }
    // drain the queue, oldest first
    const queued = await ctx.db.query("tasks").withIndex("by_outcome", (q) => q.eq("outcome", "queued")).collect();
    for (const q of queued.sort((a, b) => a.createdAt - b.createdAt)) {
      const res = await tryDispatch(ctx, q._id);
      if (res.status === "running")
        await reply(ctx, q.source, q.sender, `🤖 Robot ${res.robots.join(" + ")} picked up your queued task (~${Math.round(res.etaMs / 1000)}s).`);
      else if (res.status === "failed")
        await reply(ctx, q.source, q.sender, `⚠️ Couldn't execute queued task: ${res.reason}`);
      else break;
    }
  },
});

export const reset = mutation({
  args: { adminKey: v.string() },
  handler: async (ctx, { adminKey }) => {
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) throw new Error("bad admin key");
    for (const t of ["robots", "skills", "tasks", "metrics", "outbox", "contacts"] as const) {
      for (const d of await ctx.db.query(t).collect()) await ctx.db.delete(d._id);
    }
    await seed(ctx);
  },
});

export const saveProfile = internalMutation({
  args: { data: v.any(), source: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await ctx.db.insert("profile", { ...a, updatedAt: Date.now() });
  },
});
