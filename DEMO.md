# SpecBot Text: 90-second live demo

**Big screen:** https://specbot-text.vercel.app (3D sim left, dashboard right).
**Your hand:** iPhone, thread with your number (+1 628-997-9661) open.

## Script

| Time | Do | Say |
|---|---|---|
| 0:00–0:10 | Point a judge at the **SCAN TO TEXT** QR on the banner | "Every robot fleet needs a brain, and frontier models are expensive at fleet scale. Grab your phone and scan this." |
| 0:10–0:30 | Judge scans → enters their number → taps **📲 Text the fleet** → sends `move pallet from Dock A to Rack 3` | "That registers you on our iMessage line and pre-fills a command. Hit send." *(robot turns blue on screen)* "Your phone just got the reply: which brain planned it and what it cost. CACHE, **$0**, because it learned that skill earlier." |
| 0:30–0:40 | Click **▶ Auto-run 20 tasks** | "Now a whole shift of commands. Each one goes to the cheapest safe brain: cached skills for free, Haiku for new phrasing, Opus only when it's risky." *(curve starts climbing)* |
| 0:40–0:60 | You text `move 300 kg crate from Dock A to Rack 5` | "A dangerous one: 300 kg. We scraped this robot's real spec sheet with Firecrawl. It's a MiR250, 250 kg max. Opus plans it, then a plain-code safety validator checks it, and…" *(read the reply)* "**refused**, with a reason, before any robot moves." |
| 1:00–1:30 | Point at the **% saved** counter and the chart | "Green is what we spent, purple is all-frontier. Every number is real tokens from the API, and the baseline is measured, not assumed. **% saved** keeps climbing because Opus plans become free skills. Text a robot fleet. Pay 90% less for its brain." |

## 10–15 minutes before

1. Open `?admin=<key from admin.local>` → **Reset** (clears the queue and history).
2. Send 3 commands from the web chat to re-measure the baseline through Opus (~3 s each): `move pallet from Dock A to Rack 3`, `send robot 3 to Dock C`, `charge robot 4`.
3. Press **🔥 Firecrawl spec** so the profile reads `MiR250 · 250 kg max · firecrawl`.
4. Open the normal URL (no `?admin`) on the big screen. All 4 robots should be green.
5. Phone: Wi-Fi on, Do Not Disturb off.

Don't press Auto-run before the demo: it refuses while the queue already has 5+ tasks.

## If something breaks

- **Judge's phone won't register / iMessage is slow:** type the command in **Web chat (fallback)** on the big screen. It's the same router and the same robots.
- **Robots all busy:** "It queues safely, no collisions." Tasks start automatically as robots free up.
- **300 kg gets split instead of refused:** text `move a 300 kg crate from Dock A to Rack 5 with one robot` (tested: refused).
