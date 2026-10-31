import { v } from "convex/values";
import { action, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { HOMES, LOCATIONS, STEP_MS } from "../shared/layout";
import { occFromWaypoints, planRobot, type Occ } from "../shared/astar";
import { FALLBACK_PROFILE } from "../shared/fallbackProfile";
import type { Plan, Waypoint } from "../shared/types";

const DRAIN_PER_STEP = 0.08; // % battery per grid step (sped up for the demo)
const AUTO_CHARGE_BELOW = 25;

export const robots = query({
  args: {},
  handler: async (ctx) => ctx.db.query("robots").withIndex("by_num").collect(),
});

export const serverTime = action({ args: {}, handler: async () => Date.now() });

export async function seedCore(ctx: MutationCtx) {
  if (!(await ctx.db.query("robots").first())) {
    for (let i = 0; i < 4; i++) {
      await ctx.db.insert("robots", { num: i + 1, name: `Robot ${i + 1}`, cell: HOMES[i], battery: 100 - i * 7, path: [], busyUntil: 0 });
    }
  }
  if (!(await ctx.db.query("metrics").first())) await ctx.db.insert("metrics", { key: "main", baselineSamples: [] });
  if (!(await ctx.db.query("profile").first()))
    await ctx.db.insert("profile", { data: FALLBACK_PROFILE, source: "fallback", updatedAt: Date.now() });
}

export const seed = mutation({ args: {}, handler: async (ctx) => seedCore(ctx) });

type DispatchResult =
  | { status: "running"; robotNums: number[]; etaAt: number; target: string }
  | { status: "queued"; position: number }
  | { status: "error"; reason: string };

function firstTarget(steps: Plan["assignments"][number]["steps"]) {
  return steps.find((s) => s.action === "move_to")?.target;
}

/** Assign idle robots, compute collision-free timed paths, schedule completion. */
async function dispatchCore(ctx: MutationCtx, task: Doc<"tasks">): Promise<DispatchResult> {
  const plan = task.plan as Plan;
  const now = Date.now();
  const startStep = Math.ceil(now / STEP_MS) + 1;
  const robots = await ctx.db.query("robots").withIndex("by_num").collect();
  const idle = robots.filter((r) => r.busyUntil <= now);
  const chosen: Doc<"robots">[] = [];

  for (const a of plan.assignments) {
    let r: Doc<"robots"> | undefined;
    if (a.robot != null) r = idle.find((x) => x.num === a.robot && !chosen.includes(x));
    else {
      const tgt = LOCATIONS[firstTarget(a.steps) ?? ""]?.access;
      r = idle
        .filter((x) => !chosen.includes(x) && plan.assignments.every((b) => b.robot !== x.num) && x.battery >= 20)
        .sort((p, q) => (tgt ? Math.abs(p.cell.x - tgt.x) + Math.abs(p.cell.y - tgt.y) - (Math.abs(q.cell.x - tgt.x) + Math.abs(q.cell.y - tgt.y)) : 0))[0];
    }
    if (!r) {
      const queued = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "queued")).collect();
      if (task.status !== "queued") await ctx.db.patch(task._id, { status: "queued" });
      return { status: "queued", position: queued.filter((t) => t._id !== task._id).length + 1 };
    }
    chosen.push(r);
  }

  const planned: { r: Doc<"robots">; wps: Waypoint[]; taskEndT: number; endT: number }[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const r = chosen[i];
    const others: Occ[] = [
      ...robots.filter((x) => x._id !== r._id && !planned.some((p) => p.r._id === x._id)).map((x) => occFromWaypoints(x.path, x.cell)),
      ...planned.map((p) => occFromWaypoints(p.wps, p.wps[p.wps.length - 1])),
    ];
    const res = planRobot(r.num, r.cell, startStep, plan.assignments[i].steps, others);
    if ("error" in res) return { status: "error", reason: `Robot ${r.num}: ${res.error}` };
    planned.push({ r, wps: res.waypoints, taskEndT: res.taskEndT, endT: res.endT });
  }

  let etaAt = 0;
  for (const p of planned) {
    const charges = p.wps.some((w) => w.a === "charge");
    const battery = charges ? 100 : Math.max(0, p.r.battery - DRAIN_PER_STEP * p.wps.length);
    const last = p.wps[p.wps.length - 1];
    await ctx.db.patch(p.r._id, { path: p.wps, busyUntil: p.endT, taskId: task._id, cell: { x: last.x, y: last.y }, battery });
    await ctx.scheduler.runAt(p.endT, internal.sim.robotFree, { robotId: p.r._id });
    etaAt = Math.max(etaAt, p.taskEndT);
  }
  const target = [...plan.assignments[0].steps].reverse().find((s) => s.action === "move_to")?.target ?? "";
  await ctx.db.patch(task._id, { status: "running", robotNums: chosen.map((r) => r.num), etaAt, target });
  await ctx.scheduler.runAt(etaAt, internal.sim.complete, { taskId: task._id });
  return { status: "running", robotNums: chosen.map((r) => r.num), etaAt, target };
}

export const dispatch = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }): Promise<DispatchResult> => {
    const task = await ctx.db.get(taskId);
    if (!task) return { status: "error", reason: "task vanished" };
    return dispatchCore(ctx, task);
  },
});

export const complete = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const t = await ctx.db.get(taskId);
    if (!t || t.status !== "running") return;
    await ctx.db.patch(taskId, { status: "done", doneAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.photon.notifyDone, { taskId });
  },
});

export const robotFree = internalMutation({
  args: { robotId: v.id("robots") },
  handler: async (ctx, { robotId }) => {
    const r = await ctx.db.get(robotId);
    if (!r || r.busyUntil > Date.now() + 50) return; // a newer path superseded this timer
    await ctx.db.patch(robotId, { taskId: undefined });
    if (r.battery < AUTO_CHARGE_BELOW) await autoCharge(ctx, robotId);
    await drainQueue(ctx);
  },
});

/** Try every queued task oldest-first (no head-of-line blocking) until no idle robot can take one. */
async function drainQueue(ctx: MutationCtx) {
  const queued = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "queued")).order("asc").take(50);
  for (const t of queued) {
    const now = Date.now();
    const idle = await ctx.db.query("robots").withIndex("by_num").collect();
    if (!idle.some((x) => x.busyUntil <= now)) return;
    const res = await dispatchCore(ctx, t);
    if (res.status === "running") await ctx.scheduler.runAfter(0, internal.photon.notifyStarted, { taskId: t._id });
    if (res.status === "error") await ctx.db.patch(t._id, { status: "blocked", tier: "BLOCKED", reasons: [...t.reasons, res.reason] });
  }
  // Idle robots with low battery top up while nothing else needs them.
  for (const r of await ctx.db.query("robots").withIndex("by_num").collect())
    if (r.busyUntil <= Date.now() && r.battery < AUTO_CHARGE_BELOW) await autoCharge(ctx, r._id);
}

/** Safety sweep (cron): makes sure an idle fleet never sits next to a non-empty queue. */
export const sweep = internalMutation({ args: {}, handler: async (ctx) => drainQueue(ctx) });

async function autoCharge(ctx: MutationCtx, robotId: Id<"robots">) {
  const robots = await ctx.db.query("robots").withIndex("by_num").collect();
  const r = robots.find((x) => x._id === robotId)!;
  const startStep = Math.ceil(Date.now() / STEP_MS) + 1;
  const others = robots.filter((x) => x._id !== robotId).map((x) => occFromWaypoints(x.path, x.cell));
  const res = planRobot(r.num, r.cell, startStep, [{ action: "charge" }], others);
  if ("error" in res) return;
  const last = res.waypoints[res.waypoints.length - 1];
  await ctx.db.patch(robotId, { path: res.waypoints, busyUntil: res.endT, cell: { x: last.x, y: last.y }, battery: 100 });
  await ctx.scheduler.runAt(res.endT, internal.sim.robotFree, { robotId });
}
