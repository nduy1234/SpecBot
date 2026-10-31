import type { Profile } from "./types";

// Bundled so the demo never depends on live scraping.
export const FALLBACK_PROFILE: Profile = {
  name: "Generic warehouse AMR (fallback profile)",
  max_payload_kg: 100,
  max_speed_mps: 1.5,
  battery_minutes: 480,
  supported_actions: ["move_to", "pick", "drop", "charge", "wait"],
  forbidden_zones: ["Human Zone"],
};

export const DEFAULT_SPEC_URL = "https://www.mobile-industrial-robots.com/robots/mir250";
