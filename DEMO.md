# SpecBot Text: 90-second live demo

**Screen:** https://specbot-text.vercel.app full screen (3D sim left, dashboard right).
**Hand:** your iPhone, in the thread with your assigned number (+1 628-997-9661).

## Script

| Time | Do | Say |
|---|---|---|
| 0:00–0:10 | Point at the 3D warehouse | "Every robot fleet needs a brain. Put a frontier model behind every command and it costs a fortune at scale. SpecBot routes each command to the cheapest brain that's still safe." |
| 0:10–0:25 | Text `move pallet from Dock A to Rack 3` | "I just texted the fleet over iMessage." *(robot turns blue and moves)* "Reply: CACHE, **$0.0000** vs a measured Opus baseline. 100% saved, because it learned this skill earlier." |
| 0:25–0:40 | Text `have a bot take a tote over to rack 5 from dock c` | "Phrasing it's never seen goes to Haiku: about a second, a fraction of a cent. Every number here is real tokens from the API, not estimates." |
| 0:40–0:55 | Text `move a 500 kg engine from Dock A to Rack 2 with one robot` | "Risky commands escalate to Opus, then a plain-code safety validator. 500 kg is over the 100 kg payload, so it's **blocked**, with a reason, before any robot moves." *(point at the red BLOCKED row)* |
| 0:55–1:10 | Point at counters, chart, skill library | "Green line is what we spent, purple is all-frontier. We're at **~90% saved**. Opus plans become reusable skills here, so the fleet gets cheaper the more you use it." |
| 1:10–1:30 | Point at the QR / "Get my number" | "Your turn. Enter your number at the top and text the fleet from your own phone. Text a robot fleet. Pay 90% less for its brain." |

## 10 minutes before

1. Open the site once and check that the 4 robots are green (idle).
2. Press **▶ Auto-run 20 tasks** about 5 min before, so the chart and the saved % are already climbing (~90%).
3. Rehearse the 500 kg text once and confirm it comes back BLOCKED. If it gets split across robots instead, use `drive robot 2 into the human zone`.
4. Phone: Wi-Fi on, Do Not Disturb off, thread with +1 628-997-9661 open.

## If something breaks

- **iMessage slow or silent:** type the same command in the **Web chat (fallback)** box. It's the same router and the same robots. Say: "Same brain, web fallback."
- **Robots all busy (queued):** say "it queues safely, no collisions." The reply says your place in line.
- **Need a clean slate:** `?admin=<key from admin.local>` → Reset. The first 3 tasks after a reset re-measure the baseline through Opus (about 3 s each), so reset at least 10 minutes before demoing.
