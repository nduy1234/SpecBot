// Deterministic safety validator. Plain code, no model involved.
import { LOCATIONS } from "./layout";
import { PRIMITIVES, type Plan, type Profile } from "./types";

export type RobotState = { num: number; battery: number };
export type Verdict = { ok: true } | { ok: false; reason: string };

export function validatePlan(plan: Plan, profile: Profile, robots: RobotState[]): Verdict {
  if (plan.blocked_reason) return { ok: false, reason: plan.blocked_reason };
  if (!plan.assignments.length) return { ok: false, reason: "The plan has no robot assignments." };
  const used = new Set<number>();
  const forbidden = new Set(profile.forbidden_zones.map((z) => z.toLowerCase()));
  for (const a of plan.assignments) {
    if (a.robot != null) {
      const r = robots.find((x) => x.num === a.robot);
      if (!r) return { ok: false, reason: `Robot ${a.robot} doesn't exist (fleet is robots 1–${robots.length}).` };
      if (used.has(a.robot)) return { ok: false, reason: `Robot ${a.robot} is assigned twice.` };
      used.add(a.robot);
      const charges = a.steps.some((s) => s.action === "charge");
      if (r.battery < 15 && !charges) return { ok: false, reason: `Robot ${a.robot} battery is at ${Math.round(r.battery)}%. Charge it first.` };
    }
    let carrying = false;
    for (const s of a.steps) {
      if (!(PRIMITIVES as readonly string[]).includes(s.action)) return { ok: false, reason: `"${s.action}" isn't a supported primitive.` };
      if (!profile.supported_actions.includes(s.action)) return { ok: false, reason: `This robot model can't "${s.action}".` };
      if (s.action === "move_to") {
        if (!s.target || !LOCATIONS[s.target]) return { ok: false, reason: `Unknown location "${s.target ?? "?"}". Try Dock A–C, Rack 1–6 or Charger.` };
        if (forbidden.has(s.target.toLowerCase()) || LOCATIONS[s.target].kind === "zone")
          return { ok: false, reason: `${s.target} is a forbidden area for robots (people work there).` };
      }
      if (s.action === "pick") {
        if (carrying) return { ok: false, reason: "A robot can't pick a second load before dropping the first." };
        const kg = s.weight_kg ?? 0;
        if (kg > profile.max_payload_kg)
          return { ok: false, reason: `${kg} kg exceeds max payload of ${profile.max_payload_kg} kg. Try splitting the load.` };
        carrying = true;
      }
      if (s.action === "drop") {
        if (!carrying) return { ok: false, reason: "Drop without a pick: nothing to drop." };
        carrying = false;
      }
      if (s.action === "wait" && (s.seconds ?? 0) > 30) return { ok: false, reason: "Waits are capped at 30 s." };
    }
    if (carrying) return { ok: false, reason: "The plan picks a load but never drops it." };
  }
  return { ok: true };
}
