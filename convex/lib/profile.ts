import { z } from "zod";

export const ProfileSchema = z.object({
  model_name: z.string(),
  max_payload_kg: z.number(),
  max_speed_mps: z.number(),
  battery_minutes: z.number(),
  supported_actions: z.array(z.string()),
  forbidden_zones: z.array(z.string()),
});
export type Profile = z.infer<typeof ProfileSchema>;

// Bundled so the demo never depends on live scraping.
export const FALLBACK_PROFILE: Profile = {
  model_name: "Generic 100 kg AMR (fallback profile)",
  max_payload_kg: 100,
  max_speed_mps: 1.5,
  battery_minutes: 480,
  supported_actions: ["move_to", "pick", "drop", "charge", "wait"],
  forbidden_zones: ["Human Zone"],
};

export function stepMsFor(p: Profile) {
  // one grid cell = 1 m; clamp so the sim stays watchable
  return Math.round(Math.min(900, Math.max(400, 1000 / Math.max(0.1, p.max_speed_mps))));
}
