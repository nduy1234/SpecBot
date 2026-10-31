# SpecBot

**SpecBot Text — "Text a robot fleet. Pay 90% less for its brain."**

Text an iMessage number (via Photon Spectrum) a command like `move pallet from Dock A to Rack 3`.
A robot executes it live in a browser 3D warehouse sim, and SpecBot texts back the result plus what
the task cost versus an all-frontier baseline.

Stack: Vite + React + TypeScript, react-three-fiber, Tailwind, Recharts · Convex (DB, realtime, scheduler,
HTTP actions) · Anthropic (Haiku 5.5 cheap tier, Opus 5.5 frontier) · Photon Spectrum (iMessage) · Firecrawl.

Cost-aware router tiers: FREE (deterministic) → CACHE (learned skills, $0) → CHEAP (Haiku) →
FRONTIER (Opus, plans saved as skills) → BLOCKED (deterministic safety validator).

See `.env.example` for configuration. Full README (architecture diagram, cost methodology) coming with the deploy milestone.
