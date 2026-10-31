import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { getProfile } from "./fleet";
import { stepMsFor } from "./lib/profile";
import { BASELINE_SAMPLES } from "./lib/pricing";

export const robotPositions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const robots = await ctx.db.query("robots").withIndex("by_num").collect();
    const profile = await getProfile(ctx);
    return { robots, stepMs: stepMsFor(profile.data) };
  },
});

// Public feed: phone numbers are masked, raw sender never leaves the server.
export const feed = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").withIndex("by_created").order("desc").take(40);
    return tasks.map((t) => ({
      id: t._id,
      source: t.source,
      who: t.senderMasked,
      text: t.text,
      tier: t.outcome === "blocked" ? "BLOCKED" : t.tier,
      model: t.model,
      costUsd: t.costUsd,
      latencyMs: t.latencyMs,
      outcome: t.outcome,
      reason: t.reason,
      isBaseline: t.isBaseline,
      robots: t.robotNums,
      tokens: { in: t.inputTokens, out: t.outputTokens, cacheRead: t.cacheReadTokens, cacheWrite: t.cacheWriteTokens },
      createdAt: t.createdAt,
    }));
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").withIndex("by_created").order("asc").take(3000);
    const m = await ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "baseline")).first();
    const samples = m?.samples ?? [];
    const baseline = samples.length >= BASELINE_SAMPLES ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    let actual = 0;
    const series: { n: number; actual: number; baseline: number | null }[] = [];
    const tierCount: Record<string, number> = {};
    const tierLatency: Record<string, number> = {};
    for (const t of tasks) {
      actual += t.costUsd;
      const tier = t.outcome === "blocked" ? "BLOCKED" : t.tier;
      tierCount[tier] = (tierCount[tier] ?? 0) + 1;
      tierLatency[tier] = (tierLatency[tier] ?? 0) + t.latencyMs;
      series.push({ n: series.length + 1, actual: +actual.toFixed(5), baseline: baseline ? +(baseline * (series.length + 1)).toFixed(5) : null });
    }
    const n = tasks.length;
    const baselineTotal = baseline ? baseline * n : null;
    const nonFree = n - (tierCount.FREE ?? 0);
    return {
      tasks: n,
      actualUsd: actual,
      baselineUsd: baselineTotal,
      baselinePerTask: baseline,
      baselineSamples: samples.length,
      baselineNeeded: BASELINE_SAMPLES,
      savedPct: baselineTotal ? Math.max(0, (1 - actual / baselineTotal) * 100) : null,
      cacheHitRate: nonFree ? (tierCount.CACHE ?? 0) / nonFree : 0,
      tierCount,
      avgLatency: Object.fromEntries(Object.entries(tierLatency).map(([k, v]) => [k, v / tierCount[k]])),
      series: series.slice(-200),
    };
  },
});

export const skills = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("skills").order("desc").collect();
    return s.map((k) => ({ name: k.name, example: k.example, hits: k.hits, learnedFrom: k.learnedFrom, createdAt: k.createdAt }));
  },
});

export const myReplies = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("outbox")
      .withIndex("by_sender", (q) => q.eq("sender", sessionId))
      .order("desc")
      .take(30);
  },
});

export const myCommands = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const all = await ctx.db.query("tasks").withIndex("by_created").order("desc").take(200);
    return all.filter((t) => t.sender === sessionId).slice(0, 30).map((t) => ({ text: t.text, createdAt: t.createdAt }));
  },
});
