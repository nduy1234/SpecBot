import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { seedCore } from "./sim";

export const reset = mutation({
  args: { adminKey: v.string() },
  handler: async (ctx, { adminKey }) => {
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) throw new Error("unauthorized");
    for (const table of ["robots", "skills", "tasks", "metrics", "contacts", "webhookEvents"] as const) {
      for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
    }
    await seedCore(ctx);
  },
});

export const setProfile = internalMutation({
  args: { data: v.any(), source: v.union(v.literal("firecrawl"), v.literal("fallback")), url: v.optional(v.string()), excerpt: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("profile").first();
    if (existing) await ctx.db.replace(existing._id, { ...a, updatedAt: Date.now() });
    else await ctx.db.insert("profile", { ...a, updatedAt: Date.now() });
  },
});

export const dropSkill = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const s = await ctx.db.query("skills").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (s) await ctx.db.delete(s._id);
    return !!s;
  },
});

export const blockQueuedMatching = internalMutation({
  args: { text: v.string(), reason: v.string() },
  handler: async (ctx, { text, reason }) => {
    const rows = await ctx.db.query("tasks").withIndex("by_status", (q) => q.eq("status", "queued")).collect();
    let n = 0;
    for (const t of rows)
      if (t.text === text) {
        await ctx.db.patch(t._id, { status: "blocked", tier: "BLOCKED", reasons: [...t.reasons, reason] });
        n++;
      }
    return n;
  },
});
