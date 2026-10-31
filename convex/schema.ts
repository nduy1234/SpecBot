import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  robots: defineTable({
    num: v.number(), // 1..4
    status: v.union(v.literal("idle"), v.literal("busy")),
    battery: v.number(),
    home: v.object({ x: v.number(), y: v.number() }),
    // timed waypoints [x, y, step]; step * stepMs = server ms
    path: v.array(v.array(v.number())),
    events: v.array(v.object({ step: v.number(), type: v.string() })),
    taskId: v.optional(v.id("tasks")),
    batteryAfter: v.optional(v.number()),
  }).index("by_num", ["num"]),

  profile: defineTable({
    data: v.any(), // Profile (see lib/profile.ts)
    source: v.string(), // "fallback" | "firecrawl"
    url: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  skills: defineTable({
    signature: v.string(),
    name: v.string(),
    template: v.string(),
    example: v.string(),
    learnedFrom: v.string(), // tier that produced it
    hits: v.number(),
    createdAt: v.number(),
  }).index("by_signature", ["signature"]),

  tasks: defineTable({
    source: v.union(v.literal("imessage"), v.literal("web")),
    sender: v.string(), // raw id: never returned by public queries
    senderMasked: v.string(),
    text: v.string(),
    tier: v.string(), // FREE | CACHE | CHEAP | FRONTIER | BLOCKED
    model: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    outcome: v.string(), // answered | queued | running | done | blocked | failed
    reason: v.optional(v.string()),
    isBaseline: v.boolean(),
    plan: v.optional(v.any()),
    summary: v.optional(v.string()),
    robotNums: v.array(v.number()),
    pendingJobs: v.number(),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_outcome", ["outcome"])
    .index("by_created", ["createdAt"]),

  metrics: defineTable({
    key: v.string(), // "baseline"
    samples: v.array(v.number()),
  }).index("by_key", ["key"]),

  contacts: defineTable({
    sender: v.string(),
    source: v.string(),
    lastCommandAt: v.number(),
    count: v.number(),
  }).index("by_sender", ["sender"]),

  // every reply we send (web chat reads its own; iMessage copies are a send log)
  outbox: defineTable({
    sender: v.string(),
    source: v.string(),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_sender", ["sender", "createdAt"]),

  inbound: defineTable({ messageId: v.string() }).index("by_messageId", ["messageId"]),
});
