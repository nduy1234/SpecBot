# Night Hack submission (paste into https://tally.so/r/vXMrPv)

## Team / project name
SpecBot Text: "Text a robot fleet. Pay 90% less for its brain."
Team: <team name>. Members: <all teammates>

## Captain contact
<name>, <email>, <phone>

## What you built tonight and what already existed
Built tonight, from an empty folder (no code existed before kickoff; only public open-source libraries and the partner APIs below):
- An iMessage agent that commands a 4-robot warehouse fleet. Text a command like "move pallet from Dock A to Rack 3", and a robot carries it out live in a shared 3D browser sim. SpecBot texts back which AI "brain" planned the task and what it cost compared with an all-frontier baseline, then texts again when the task is done.
- Cost-aware router, used for every command:
  - FREE: deterministic help/status, no model call.
  - CACHE: learned skill templates, $0.
  - CHEAP: Claude Haiku 5.5 with prompt caching.
  - FRONTIER: Claude Opus 5.5, only for novel, risky, or low-confidence commands, or ones that failed validation.
  - A plain-code safety validator (payload, forbidden human zone, battery, unknown locations) checks every plan. Unsafe requests come back BLOCKED with a plain-English reason.
  - Successful Opus plans are saved as reusable skills, so the fleet gets cheaper the more it's used.
- Real costs only: every task logs input, output, and cached tokens from the API's usage field. The baseline is the measured average of the first 3 all-frontier tasks, not an estimate.
- Server-authoritative sim on Convex: space-time A* with cell reservation (no collisions), timed waypoints, a task queue, and auto-charging. Every viewer sees the same fleet, and texts work even with no browser open.
- Live robot profile: Firecrawl scrapes the MiR250 spec page, and Claude extracts payload, speed, and battery, which the safety validator then uses.
- Realtime dashboard: % saved, spend vs baseline, cost chart, cache hit rate, latency per tier, a live feed with tier badges and escalation reasons, the skill library, a web chat fallback, and Auto-run.
Built with Claude Code.

## Working demo link + access instructions
https://specbot-text.vercel.app

To text it over iMessage (iPhone or Mac):
1. Open the site and enter your phone number (with country code) or Apple ID email in the top banner, then press "Get my number".
2. The site shows your iMessage number and a QR code. Photon's shared lines only accept registered senders, and this step registers you.
3. Text that number, for example: "move pallet from Dock A to Rack 3", "have a bot take a tote over to rack 5 from dock c", "move a 500 kg engine from Dock A to Rack 2 with one robot", "status", "help".
4. Watch the robot move on the site. You'll get an acknowledgment with the brain tier and cost, then a "Done" text.
No iPhone? Use the "Web chat (fallback)" box on the same page. It runs the same router and the same robots.

## Partner tools used
- Anthropic Claude API: Haiku 5.5 (cheap tier), Opus 5.5 (frontier tier), prompt caching
- Photon: iMessage agent (Photon 2.0 API with webhooks in, sendMessage replies, and shared-line assignments for self-serve signup)
- Firecrawl: live robot spec scraping
- Also: Convex (database, realtime, scheduler, HTTP actions), Vercel (hosting)

## Photon: reachable iMessage number / handle
Register at https://specbot-text.vercel.app to get your number (for example, the team's test line is +1 628-997-9661, reachable from registered senders). It's a working iMessage agent over the Photon iMessage network, not SMS.
