import { z } from "zod";

export const PRIMITIVES = ["move_to", "pick", "drop", "charge", "wait"] as const;

// Loose on `action` on purpose: the deterministic validator explains invalid primitives.
export const StepSchema = z.object({
  action: z.string(),
  target: z.string().optional(),
  item: z.string().optional(),
  weight_kg: z.number().optional(),
  seconds: z.number().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const PlanSchema = z.object({
  assignments: z
    .array(z.object({ robot: z.number().int().nullable().default(null), steps: z.array(StepSchema).min(1) }))
    .max(4)
    .default([]),
  confidence: z.number().min(0).max(1),
  summary: z.string().default(""),
  risky: z.boolean().default(false),
  blocked_reason: z.string().nullable().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const ProfileSchema = z.object({
  name: z.string().default("Generic AMR"),
  max_payload_kg: z.number().positive(),
  max_speed_mps: z.number().positive(),
  battery_minutes: z.number().positive(),
  supported_actions: z.array(z.string()).min(1),
  forbidden_zones: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

export type Tier = "FREE" | "CACHE" | "CHEAP" | "FRONTIER" | "BLOCKED";

export type Waypoint = { x: number; y: number; t: number; a?: string; c?: boolean };

export function maskPhone(p: string) {
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : "••••";
}
