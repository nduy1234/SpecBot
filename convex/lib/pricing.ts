// Single source of truth for model IDs and prices (USD per 1M tokens).
// Verified against Anthropic's published model table (claude-api skill, cached 2026-10-06).
// Re-check https://docs.claude.com/en/docs/about-claude/pricing before the demo.
// Cache writes are 1.25x base input (5-minute TTL); cache reads use the per-model rate below.

export const MODELS = {
  cheap: {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01, // ~0.1x input
  },
  frontier: {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    input: 4.0,
    output: 20.0,
    cacheWrite: 5.0,
    cacheRead: 0.2,
  },
} as const;

export type ModelTier = keyof typeof MODELS;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function costOf(tier: ModelTier, u: Usage): number {
  const p = MODELS[tier];
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

export const BASELINE_SAMPLES = 3;
