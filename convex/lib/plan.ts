import { z } from "zod";
import { BATTERY_PER_CELL, PRIMITIVES, findLocation, LOCATIONS, HOME_BAYS } from "./warehouse";
import type { Profile } from "./profile";

// ---- Plan schema (validated with zod for every model response) ----------
export const StepSchema = z.object({
  action: z.enum(PRIMITIVES),
  target: z.string().nullable(),
  seconds: z.number().nullable(),
});
export const PlanSchema = z.object({
  jobs: z.array(
    z.object({
      robot: z.number().nullable(), // 1-4 if user named a robot, else null
      steps: z.array(StepSchema),
    }),
  ),
  payload_kg: z.number(),
  summary: z.string(), // past tense, e.g. "Pallet delivered to Rack 3"
  confidence: z.number(),
  blocked: z.boolean(),
  blocked_reason: z.string().nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ---- Tier 0: free deterministic commands -------------------------------
export type FreeCmd =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "where"; robot: number }
  | { kind: "dashboard" };

export function parseFree(text: string): FreeCmd | null {
  const t = text.trim().toLowerCase().replace(/[!?.]+$/, "");
  if (/^(help|commands|menu|hi|hello|hey|start)$/.test(t)) return { kind: "help" };
  if (/^(status|fleet|fleet status|robots)$/.test(t)) return { kind: "status" };
  const w = t.match(/^where(?:'s| is)? robot\s*#?(\d)$/);
  if (w) return { kind: "where", robot: Number(w[1]) };
  if (/^(dashboard|link|url|watch)$/.test(t)) return { kind: "dashboard" };
  return null;
}

// ---- Tier 1: normalize into intent + params ----------------------------
export type Normalized = {
  signature: string | null; // null = could not normalize (novel)
  params: Record<string, string>;
  risky: string | null; // reason to go straight to frontier
};

const LOC_RE = /\b(dock\s*[abc]|rack\s*[1-6]|charg(?:er|ing)(?:\s*station)?|human\s*zone)\b/g;
const TRANSPORT = /\b(move|bring|take|deliver|transport|carry|haul|shift|send|fetch|get)\b/;
const GOTO = /\b(go|drive|head|navigate|park|patrol|visit)\b/;
const CHARGE = /\b(charge|recharge)\b/;

function canonLoc(raw: string) {
  return findLocation(raw)?.name ?? raw;
}

export function normalize(text: string): Normalized {
  const t = text.toLowerCase();
  const locs = [...t.matchAll(LOC_RE)].map((m) => canonLoc(m[1]));
  const robotM = t.match(/\brobot\s*#?(\d)\b/);
  const kgM = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo|kilos|kilograms)\b/);
  const params: Record<string, string> = {};
  locs.forEach((l, i) => (params[`LOC${i + 1}`] = l));
  if (robotM) params.ROBOT = robotM[1];
  if (kgM) params.KG = kgM[1];

  let risky: string | null = null;
  if (/human\s*zone/.test(t)) risky = "mentions the human zone";
  else if (/\b(robots|all|both|two|three|four|every|fleet|together)\b/.test(t) || /\d\s*robots/.test(t))
    risky = "multi-robot request";
  else if (locs.length > 2 || /\b(then|after that|and then)\b/.test(t)) risky = "multi-step request";
  else if (/\b(fragile|careful|urgent|emergency|unsafe|person|people|human)\b/.test(t))
    risky = "risk keyword";

  let intent: string | null = null;
  if (CHARGE.test(t)) intent = "charge";
  else if (TRANSPORT.test(t) && locs.length === 2) intent = "transport";
  else if ((GOTO.test(t) || TRANSPORT.test(t)) && locs.length === 1) intent = "goto";

  if (!intent) return { signature: null, params, risky: risky ?? "novel / ambiguous phrasing" };
  const slots = [locs.map(() => "LOC").join(","), robotM ? "R" : "", kgM ? "KG" : ""]
    .filter(Boolean)
    .join("+");
  return { signature: `${intent}|${slots}`, params, risky };
}

// ---- Skills: plan <-> parameterized template ---------------------------
export function toTemplate(plan: Plan, params: Record<string, string>): string | null {
  let s = JSON.stringify(plan);
  // longest values first so "Rack 3" placeholders don't partially clash
  const entries = Object.entries(params).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of entries) {
    if (k.startsWith("LOC")) {
      if (!s.includes(`"${v}"`)) return null; // template would not generalize
      s = s.split(`"${v}"`).join(`"{{${k}}}"`).split(v).join(`{{${k}}}`);
    }
  }
  if (params.ROBOT) s = s.split(`"robot":${params.ROBOT}`).join(`"robot":"{{ROBOT}}"`);
  if (params.KG) s = s.split(`"payload_kg":${Number(params.KG)}`).join(`"payload_kg":"{{KG}}"`);
  return s;
}

export function fromTemplate(tpl: string, params: Record<string, string>): Plan | null {
  let s = tpl;
  if (params.ROBOT) s = s.split(`"{{ROBOT}}"`).join(params.ROBOT);
  if (params.KG) s = s.split(`"{{KG}}"`).join(String(Number(params.KG)));
  for (const [k, v] of Object.entries(params)) s = s.split(`{{${k}}}`).join(v);
  if (s.includes("{{")) return null;
  const r = PlanSchema.safeParse(JSON.parse(s));
  return r.success ? { ...r.data, confidence: 1 } : null;
}

// ---- Deterministic safety validator ------------------------------------
export type RobotLite = { num: number; battery: number; status: string };

export function validatePlan(
  plan: Plan,
  profile: Profile,
  robots: RobotLite[],
): { ok: true } | { ok: false; reason: string } {
  if (plan.blocked) return { ok: false, reason: plan.blocked_reason ?? "planner refused" };
  if (!plan.jobs.length) return { ok: false, reason: "plan has no jobs" };
  if (plan.jobs.length > robots.length)
    return { ok: false, reason: `needs ${plan.jobs.length} robots but fleet has ${robots.length}` };
  if (plan.payload_kg > profile.max_payload_kg)
    return {
      ok: false,
      reason: `${plan.payload_kg} kg exceeds max payload of ${profile.max_payload_kg} kg`,
    };
  const forbidden = profile.forbidden_zones.map((z) => z.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const job of plan.jobs) {
    if (!job.steps.length) return { ok: false, reason: "a job has no steps" };
    if (job.robot !== null && !robots.some((r) => r.num === job.robot))
      return { ok: false, reason: `robot ${job.robot} does not exist` };
    let holding = false;
    let prev = { x: HOME_BAYS[0].x, y: HOME_BAYS[0].y };
    let dist = 0;
    let charges = false;
    for (const st of job.steps) {
      if (!PRIMITIVES.includes(st.action) || !profile.supported_actions.includes(st.action))
        return { ok: false, reason: `"${st.action}" is not a supported primitive` };
      if (st.action === "move_to") {
        const loc = findLocation(st.target);
        if (!loc)
          return {
            ok: false,
            reason: `unknown location "${st.target}". Known: ${LOCATIONS.filter((l) => l.kind !== "zone").map((l) => l.name).join(", ")}`,
          };
        const key = loc.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (forbidden.includes(key)) return { ok: false, reason: `${loc.name} is a forbidden zone` };
        dist += Math.abs(loc.access.x - prev.x) + Math.abs(loc.access.y - prev.y);
        prev = loc.access;
      }
      if (st.action === "pick") {
        if (holding) return { ok: false, reason: "picks twice without dropping" };
        holding = true;
      }
      if (st.action === "drop") {
        if (!holding) return { ok: false, reason: "drops without picking anything up" };
        holding = false;
      }
      if (st.action === "charge") charges = true;
    }
    if (holding) return { ok: false, reason: "plan ends while still carrying the load" };
    const need = (dist + 15) * BATTERY_PER_CELL + 10;
    const candidates = job.robot !== null ? robots.filter((r) => r.num === job.robot) : robots;
    const best = Math.max(...candidates.map((r) => r.battery));
    if (!charges && best < need)
      return {
        ok: false,
        reason: `battery too low (${Math.round(best)}% available, ~${Math.round(need)}% needed). Text "charge robot N" first`,
      };
  }
  return { ok: true };
}
