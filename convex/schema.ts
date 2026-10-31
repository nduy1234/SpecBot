import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const waypoint = v.object({ x: v.number(), y: v.number(), t: v.number(), a: v.optional(v.string()), c: v.optional(v.boolean()) });

export default defineSchema({
  robots: defineTable({
    num: v.number(),
    name: v.string(),
    cell: v.object({ x: v.number(), y: v.number() }),
    battery: v.number(),
    path: v.array(waypoint),
    busyUntil: v.number(),
    taskId: v.optional(v.id("tasks")),
  }).index("by_num", ["num"]),

  profile: defineTable({
    data: v.any(),
    source: v.union(v.literal("firecrawl"), v.literal("fallback")),
    url: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  skills: defineTable({
    key: v.string(),
    template: v.any(),
    example: v.string(),
    learnedFrom: v.string(), // tier that produced it
    hits: v.number(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  tasks: defineTable({
    source: v.union(v.literal("imessage"), v.literal("web"), v.literal("autorun")),
    senderMasked: v.string(),
    contactId: v.optional(v.id("contacts")),
    webSession: v.optional(v.string()),
    text: v.string(),
    tier: v.string(), // FREE | CACHE | CHEAP | FRONTIER | BLOCKED | PENDING
    model: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    status: v.string(), // planning | queued | running | done | blocked | answered
    plan: v.optional(v.any()),
    reasons: v.array(v.string()),
    replies: v.array(v.string()),
    robotNums: v.array(v.number()),
    target: v.optional(v.string()),
    baselineSample: v.boolean(),
    etaAt: v.optional(v.number()),
    doneAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_session", ["webSession"]),

  metrics: defineTable({
    key: v.string(),
    baselineUsd: v.optional(v.number()),
    baselineSamples: v.array(v.number()),
  }).index("by_key", ["key"]),

  contacts: defineTable({
    key: v.string(), // E.164 phone or web session id
    source: v.string(),
    spaceId: v.optional(v.string()),
    agentId: v.optional(v.string()), // Photon User ID of our shared-line agent
    firstSeen: v.number(),
    lastCmdAt: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  webhookEvents: defineTable({ messageId: v.string(), at: v.number() }).index("by_messageId", ["messageId"]),
});
