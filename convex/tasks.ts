import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { BASELINE_SAMPLES } from "../shared/pricing";
import { maskPhone } from "../shared/types";

const RATE_LIMIT_MS = 5000;

// ---------- public, read-only (no raw phone numbers ever leave these) ----------

function publicTask(t: Doc<"tasks">) {
  const { contactId: _c, ...rest } = t;
  return rest;
}

export const feed = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("tasks").order("desc").take(40);
    return rows.map(publicTask);
  },
});

export const bySession = query({
  args: { session: v.string() },
  handler: async (ctx, { session }) => {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_session", (q) => q.eq("webSession", session))
      .order("desc")
      .take(15);
    return rows.reverse().map(publicTask);
  },
});

export const skills = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("skills").order("desc").collect()).map(({ template, ...s }) => ({ ...s, steps: template?.assignments?.[0]?.steps?.length ?? 0 })),
});

export const profile = query({ args: {}, handler: async (ctx) => (await ctx.db.query("profile").first()) ?? null });

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const metrics = await ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "main")).first();
    const samples = metrics?.baselineSamples ?? [];
    const measured = samples.length >= BASELINE_SAMPLES;
    const perTask = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    const all = await ctx.db.query("tasks").order("asc").collect();
    const robotTasks = all.filter((t) => t.tier !== "FREE" && t.tier !== "PENDING");
    let cum = 0;
    const series = robotTasks.map((t, i) => {
      cum += t.costUsd;
      return { n: i + 1, actual: +cum.toFixed(5), baseline: perTask != null ? +((i + 1) * perTask).toFixed(5) : null };
    });
    const tiers = ["FREE", "CACHE", "CHEAP", "FRONTIER", "BLOCKED"] as const;
    const latency = Object.fromEntries(
      tiers.map((tier) => {
        const xs = all.filter((t) => t.tier === tier);
        return [tier, { count: xs.length, avgMs: xs.length ? Math.round(xs.reduce((a, t) => a + t.latencyMs, 0) / xs.length) : null }];
      }),
    );
    const spent = cum;
    const baselineTotal = perTask != null ? perTask * robotTasks.length : null;
    return {
      tasks: robotTasks.length,
      freeCommands: all.length - robotTasks.length,
      spent,
      baselineTotal,
      perTaskBaseline: perTask,
      baselineMeasured: measured,
      baselineSamples: samples.length,
      pctSaved: baselineTotal ? Math.max(0, 1 - spent / baselineTotal) * 100 : null,
      cacheHitRate: robotTasks.length ? (latency.CACHE.count / robotTasks.length) * 100 : 0,
      latency,
      series,
    };
  },
});

// ---------- internal ----------

export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [profile, skills, robots, metrics] = await Promise.all([
      ctx.db.query("profile").first(),
      ctx.db.query("skills").collect(),
      ctx.db.query("robots").withIndex("by_num").collect(),
      ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "main")).first(),
    ]);
    return { profile, skills, robots, metrics };
  },
});

export const begin = internalMutation({
  args: { source: v.string(), senderKey: v.string(), spaceId: v.optional(v.string()), agentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const c = await ctx.db.query("contacts").withIndex("by_key", (q) => q.eq("key", a.senderKey)).first();
    if (!c) {
      const id = await ctx.db.insert("contacts", { key: a.senderKey, source: a.source, spaceId: a.spaceId, agentId: a.agentId, firstSeen: now, lastCmdAt: now, count: 1 });
      return { contactId: id, isNew: true, limited: false };
    }
    const limited = a.source !== "autorun" && now - c.lastCmdAt < RATE_LIMIT_MS;
    await ctx.db.patch(c._id, { lastCmdAt: limited ? c.lastCmdAt : now, count: c.count + 1, spaceId: a.spaceId ?? c.spaceId, agentId: a.agentId ?? c.agentId });
    return { contactId: c._id, isNew: false, limited };
  },
});

export const getContact = internalQuery({ args: { id: v.id("contacts") }, handler: (ctx, { id }) => ctx.db.get(id) });
export const getTask = internalQuery({ args: { id: v.id("tasks") }, handler: (ctx, { id }) => ctx.db.get(id) });

export const create = internalMutation({
  args: {
    source: v.union(v.literal("imessage"), v.literal("web"), v.literal("autorun")),
    senderKey: v.string(),
    contactId: v.optional(v.id("contacts")),
    text: v.string(),
    tier: v.string(),
    status: v.string(),
  },
  handler: async (ctx, a) =>
    ctx.db.insert("tasks", {
      source: a.source,
      senderMasked: a.source === "imessage" ? maskPhone(a.senderKey) : a.source === "autorun" ? "auto-run" : "web",
      contactId: a.contactId,
      webSession: a.source === "web" ? a.senderKey : undefined,
      text: a.text.slice(0, 280),
      tier: a.tier,
      model: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: a.status,
      reasons: [],
      replies: [],
      robotNums: [],
      baselineSample: false,
      createdAt: Date.now(),
    }),
});

export const patch = internalMutation({
  args: { id: v.id("tasks"), fields: v.any() },
  handler: async (ctx, { id, fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const appendReply = internalMutation({
  args: { id: v.id("tasks"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const t = await ctx.db.get(id);
    if (t) await ctx.db.patch(id, { replies: [...t.replies, text] });
  },
});

export const recordBaseline = internalMutation({
  args: { cost: v.number() },
  handler: async (ctx, { cost }) => {
    const m = await ctx.db.query("metrics").withIndex("by_key", (q) => q.eq("key", "main")).first();
    if (!m) return;
    if (m.baselineSamples.length >= BASELINE_SAMPLES) return;
    const samples = [...m.baselineSamples, cost];
    await ctx.db.patch(m._id, {
      baselineSamples: samples,
      baselineUsd: samples.length >= BASELINE_SAMPLES ? samples.reduce((a, b) => a + b, 0) / samples.length : undefined,
    });
  },
});

export const learnSkill = internalMutation({
  args: { key: v.string(), template: v.any(), example: v.string(), learnedFrom: v.string() },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("skills").withIndex("by_key", (q) => q.eq("key", a.key)).first();
    if (existing) return false;
    await ctx.db.insert("skills", { ...a, hits: 0, createdAt: Date.now() });
    return true;
  },
});

export const bumpSkill = internalMutation({
  args: { id: v.id("skills") },
  handler: async (ctx, { id }) => {
    const s = await ctx.db.get(id);
    if (s) await ctx.db.patch(id, { hits: s.hits + 1 });
  },
});

export const dedupe = internalMutation({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const seen = await ctx.db.query("webhookEvents").withIndex("by_messageId", (q) => q.eq("messageId", messageId)).first();
    if (seen) return false;
    await ctx.db.insert("webhookEvents", { messageId, at: Date.now() });
    return true;
  },
});
