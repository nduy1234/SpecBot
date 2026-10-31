// Single source of truth for model IDs and prices.
// Verified against the Claude API model table (cached 2026-10-06):
//   claude-haiku-5-5: $0.10 in / $0.50 out per MTok (prompts <= 100K tokens)
//   claude-opus-5-5:  $4.00 in / $20.00 out per MTok
// Cache reads are 0.1x input, 5-minute cache writes are 1.25x input.

export const MODELS = {
  cheap: "claude-haiku-5-5",
  frontier: "claude-opus-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export const PRICES: Record<ModelId, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
};

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = 1.25;

// Effort per tier (Opus 5.5 can't disable thinking; low keeps latency demo-friendly).
export const EFFORT = { cheap: "low", frontier: "low" } as const;

export const BASELINE_SAMPLES = 3;

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function costUsd(model: ModelId, u: Usage): number {
  const p = PRICES[model];
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.input * CACHE_READ_MULT +
      u.cacheWriteTokens * p.input * CACHE_WRITE_MULT) /
    1_000_000
  );
}
