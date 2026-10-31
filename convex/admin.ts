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
