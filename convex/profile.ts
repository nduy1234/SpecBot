"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractProfile } from "./lib/llm";
import { DEFAULT_SPEC_URL, FALLBACK_PROFILE } from "../shared/fallbackProfile";
import { ProfileSchema } from "../shared/types";

/** Firecrawl a public AMR spec page, have Claude extract a compact profile. Falls back to the bundled one. */
export const refresh = action({
  args: { url: v.optional(v.string()), adminKey: v.string() },
  handler: async (ctx, { url, adminKey }) => {
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) throw new Error("unauthorized");
    const target = url ?? process.env.PROFILE_URL ?? DEFAULT_SPEC_URL;
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, formats: ["markdown"], onlyMainContent: true }),
      });
      if (!res.ok) throw new Error(`firecrawl ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const md: string = json?.data?.markdown ?? "";
      if (md.length < 200) throw new Error("scrape returned too little text");
      const profile = ProfileSchema.parse({ ...(await extractProfile(md)), supported_actions: FALLBACK_PROFILE.supported_actions, forbidden_zones: FALLBACK_PROFILE.forbidden_zones });
      await ctx.runMutation(internal.admin.setProfile, { data: profile, source: "firecrawl", url: target, excerpt: md.slice(0, 4000) });
      return { source: "firecrawl", profile };
    } catch (e) {
      console.error("profile refresh failed, using fallback", e);
      await ctx.runMutation(internal.admin.setProfile, { data: FALLBACK_PROFILE, source: "fallback" });
      return { source: "fallback", error: String(e), profile: FALLBACK_PROFILE };
    }
  },
});
