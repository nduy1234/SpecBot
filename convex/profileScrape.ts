import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { MODELS } from "./lib/pricing";
import { FALLBACK_PROFILE, ProfileSchema } from "./lib/profile";
import { PRIMITIVES } from "./lib/warehouse";

export const DEFAULT_SPEC_URL = "https://www.mobile-industrial-robots.com/robots/mir100";

// Firecrawl the spec page, then let the cheap model extract a compact profile.
// Any failure stores the bundled fallback so the demo never depends on live scraping.
export const refresh = action({
  args: { url: v.optional(v.string()), adminKey: v.string() },
  handler: async (ctx, { url, adminKey }) => {
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) throw new Error("bad admin key");
    const target = url ?? process.env.PROFILE_URL ?? DEFAULT_SPEC_URL;
    try {
      const fc = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, formats: ["markdown"], onlyMainContent: true }),
      });
      if (!fc.ok) throw new Error(`firecrawl ${fc.status}`);
      const body = (await fc.json()) as { data?: { markdown?: string } };
      const md = body.data?.markdown;
      if (!md) throw new Error("firecrawl returned no markdown");
      const resp = await new Anthropic().messages.parse({
        model: MODELS.cheap.id,
        max_tokens: 4000,
        output_config: { effort: "low", format: zodOutputFormat(ProfileSchema) },
        messages: [
          {
            role: "user",
            content: `Extract a compact robot profile from this AMR spec page. max_payload_kg is the top-module payload in kg, max_speed_mps in m/s, battery_minutes is runtime in minutes. supported_actions must be a subset of ${JSON.stringify(PRIMITIVES)} (an AMR that carries loads supports all of them). forbidden_zones must include "Human Zone".\n\n${md.slice(0, 30000)}`,
          },
        ],
      });
      const p = ProfileSchema.parse(resp.parsed_output);
      p.supported_actions = p.supported_actions.filter((a) => (PRIMITIVES as readonly string[]).includes(a));
      if (!p.forbidden_zones.includes("Human Zone")) p.forbidden_zones.push("Human Zone");
      await ctx.runMutation(internal.fleet.saveProfile, { data: p, source: "firecrawl", url: target });
      return { source: "firecrawl", profile: p };
    } catch (e) {
      console.warn("profile scrape failed, using fallback", e);
      await ctx.runMutation(internal.fleet.saveProfile, { data: FALLBACK_PROFILE, source: "fallback" });
      return { source: "fallback", profile: FALLBACK_PROFILE, error: String(e) };
    }
  },
});
