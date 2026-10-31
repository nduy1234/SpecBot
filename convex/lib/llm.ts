import Anthropic from "@anthropic-ai/sdk";
import { costUsd, EFFORT, MODELS, type ModelId, type Usage } from "../../shared/pricing";
import { PlanSchema, type Plan } from "../../shared/types";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 45_000 }));

export type LlmResult = { plan: Plan; usage: Usage; cost: number; model: ModelId; latencyMs: number };
export class LlmError extends Error {
  usage: Usage;
  cost: number;
  constructor(msg: string, usage: Usage, cost: number) {
    super(msg);
    this.usage = usage;
    this.cost = cost;
  }
}

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

function extractJson(text: string) {
  const a = text.indexOf("{"),
    b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(a, b + 1));
}

/** One planner call with one retry. Usage/cost are real numbers from the API usage field. */
export async function plan(tier: "cheap" | "frontier", staticPrefix: string, dynamic: string, command: string): Promise<LlmResult> {
  const model = MODELS[tier];
  const total = zero();
  const t0 = Date.now();
  let lastErr: unknown;
  let useFallbacks = tier === "frontier";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const params = {
        model,
        max_tokens: tier === "cheap" ? 1500 : 6000,
        output_config: { effort: EFFORT[tier] },
        ...(tier === "cheap" ? { thinking: { type: "disabled" as const } } : {}),
        system: [
          { type: "text" as const, text: staticPrefix, cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: dynamic },
        ],
        messages: [{ role: "user" as const, content: `Command: ${command}` }],
      };
      const res = useFallbacks
        ? await anthropic().beta.messages.create({
            ...params,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
        : await anthropic().messages.create(params as Anthropic.MessageCreateParamsNonStreaming);
      const u = res.usage;
      total.inputTokens += u.input_tokens;
      total.outputTokens += u.output_tokens;
      total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      if (res.stop_reason === "refusal") throw new Error("model refused");
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const parsed = PlanSchema.parse(extractJson(text));
      return { plan: parsed, usage: total, cost: costUsd(model, total), model, latencyMs: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      // If the fallback beta itself is rejected, retry plainly.
      if (e instanceof Anthropic.BadRequestError && useFallbacks) useFallbacks = false;
      console.error(`${tier} planner attempt ${attempt + 1} failed`, e);
    }
  }
  throw new LlmError(String(lastErr), total, costUsd(model, total));
}

/** Extract a robot profile from scraped spec text. */
export async function extractProfile(markdown: string) {
  const res = await anthropic().messages.create({
    model: MODELS.cheap,
    max_tokens: 800,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system:
      'Extract a compact JSON robot profile from this AMR spec page. Output ONLY JSON: {"name":string,"max_payload_kg":number,"max_speed_mps":number,"battery_minutes":number,"supported_actions":["move_to","pick","drop","charge","wait"],"forbidden_zones":["Human Zone"]}. Convert units (hours→minutes, km/h→m/s). If a value is missing, use a conservative guess.',
    messages: [{ role: "user", content: markdown.slice(0, 20000) }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return extractJson(text);
}
