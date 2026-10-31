// Abuse limits for the public demo (pure, unit-tested). Configured via Convex env vars.
export const DEFAULTS = {
  webPerMin: 20, // all web-chat sessions combined (session ids are client-chosen, so per-session limits alone are not enough)
  budgetUsd: 5, // total LLM spend before CHEAP/FRONTIER tiers shut off
  autoRunCooldownMs: 90_000, // one Auto-run batch (20 cmds x 3s) at a time
};

export function envNumber(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type Window = { windowStart: number; count: number };

// Fixed-window counter. Returns whether this hit is allowed and the window to store.
export function hitWindow(prev: Window | null, now: number, windowMs: number, max: number): { allowed: boolean; next: Window } {
  if (!prev || now - prev.windowStart >= windowMs) return { allowed: max > 0, next: { windowStart: now, count: max > 0 ? 1 : 0 } };
  if (prev.count >= max) return { allowed: false, next: prev };
  return { allowed: true, next: { windowStart: prev.windowStart, count: prev.count + 1 } };
}

export function overBudget(spentUsd: number, budgetUsd: number) {
  return spentUsd >= budgetUsd;
}

export function checkAdminKey(expected: string | undefined, given: string | null | undefined) {
  return !!expected && !!given && expected === given;
}
