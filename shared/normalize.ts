// Deterministic command normalization: intent + params, used for the CACHE tier and skill learning.
import { canonicalLocation } from "./layout";
import type { Plan } from "./types";

export type Intent = { key: string; params: Record<string, string | number> };

const LOC = String.raw`(dock\s*[abc]|rack\s*#?\s*[1-6]|charg\w*(?:\s+(?:station|bay|dock))?|human\s+(?:zone|area))`;
const ARTICLES = /\b(a|an|the|some|one|this|that|please|robot\s*\d)\b/g;

export function normalize(raw: string): Intent | null {
  const text = raw.toLowerCase().replace(/[!.]+$/g, "").trim();
  const robotM = text.match(/\b(?:robot|r|bot)\s*#?\s*([1-9])\b/);
  const robot = robotM ? Number(robotM[1]) : undefined;
  const kgM = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?|kilograms?)\b/);
  const kg = kgM ? Number(kgM[1]) : undefined;

  const tr = text.match(new RegExp(String.raw`\b(move|bring|take|carry|deliver|transport|ship|haul|send|get)\b(.*?)\bfrom\s+${LOC}\s+(?:to|into|onto)\s+${LOC}`));
  if (tr) {
    const item =
      tr[2].replace(kgM?.[0] ?? "", "").replace(ARTICLES, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim() || "pallet";
    const params: Intent["params"] = { item, from: canonicalLocation(tr[3])!, to: canonicalLocation(tr[4])! };
    if (robot) params.robot = robot;
    if (kg != null) params.kg = kg;
    return { key: `transport${robot ? "+robot" : ""}${kg != null ? "+kg" : ""}`, params };
  }
  const ch = text.match(/^(?:please\s+)?(?:charge\s+(?:robot|r|bot)\s*#?\s*([1-9])|(?:send\s+)?(?:robot|r|bot)\s*#?\s*([1-9])\s+(?:to\s+)?(?:go\s+)?charg\w*.*)$/);
  if (ch) return { key: "charge", params: { robot: Number(ch[1] ?? ch[2]) } };
  const gt = text.match(new RegExp(String.raw`^(?:please\s+)?(?:send|move|drive|go|park|take)\s+(?:robot|r|bot)\s*#?\s*([1-9])\s+(?:to|over to)\s+${LOC}$`));
  if (gt) return { key: "goto", params: { robot: Number(gt[1]), to: canonicalLocation(gt[2])! } };
  return null;
}

/** Risky/novel signals that should skip the cheap tier. */
export function riskSignals(raw: string): string[] {
  const t = raw.toLowerCase();
  const out: string[] = [];
  if (/\bhuman|people|worker|person|staff\b/.test(t)) out.push("mentions the human zone/people");
  if (/\b(all|every|both|two|three|four|multiple|several)\s+(robots|bots|of them)\b|\brobots\b|\btogether\b|\bsplit\b/.test(t)) out.push("multi-robot");
  if (/\b(maybe|somewhere|whatever|anything|something|not sure|idk)\b|\?$/.test(t)) out.push("ambiguous");
  if (/\b(fragile|hazard|hazardous|chemical|danger|careful)\b/.test(t)) out.push("hazard/fragile");
  return out;
}

type Template = Plan;
const PH = (k: string) => `{{${k}}}`;

/** Replace literal param values in a plan with placeholders. Returns null if not generalizable. */
export function parameterize(plan: Plan, intent: Intent): Template | null {
  const p = intent.params;
  let hits = 0;
  const t: Template = JSON.parse(JSON.stringify(plan));
  t.blocked_reason = null;
  for (const a of t.assignments) {
    if (p.robot != null && a.robot === p.robot) (a as { robot: unknown }).robot = PH("robot");
    for (const s of a.steps) {
      if (s.target && s.target === p.from) (s.target = PH("from")), hits++;
      else if (s.target && s.target === p.to) (s.target = PH("to")), hits++;
      if (s.item && p.item && s.item.toLowerCase() === String(p.item).toLowerCase()) s.item = PH("item");
      if (s.weight_kg != null && p.kg != null && s.weight_kg === p.kg) (s as { weight_kg: unknown }).weight_kg = PH("kg");
    }
  }
  const needed = ["from", "to"].filter((k) => p[k] != null).length;
  if (hits < needed) return null;
  return t;
}

export function fillTemplate(t: Template, intent: Intent): Plan {
  const p = intent.params;
  const json = JSON.stringify(t).replace(/"\{\{(\w+)\}\}"/g, (_m, k: string) => {
    const v = p[k];
    if (v == null) return k === "kg" ? "20" : k === "robot" ? "null" : JSON.stringify(k === "item" ? "pallet" : "");
    return JSON.stringify(v);
  });
  return JSON.parse(json);
}
