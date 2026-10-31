# Deploying SpecBot (Convex + Vercel + Photon iMessage)

Never paste secret values into chat, commits or screenshots. All `npx convex env set` values below are typed by you.

## 0. Local checks

```bash
npm ci
npm test          # webhook signature, router parser, safety validator, abuse limits
npm run typecheck # frontend + convex/
npm run build
```

## 1. Convex (backend)

```bash
npx convex dev            # first run: log in, create the project; writes .env.local (VITE_CONVEX_URL)
```

Set prod env vars (dashboard → Settings → Environment Variables, or the CLI with `--prod`):

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Haiku 5.5 + Opus 5.5 |
| `ADMIN_KEY` | yes | long random string; unlocks Reset / Auto-run / profile refresh via `?admin=<key>` |
| `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` | for iMessage | Photon project credentials (outbound sends) |
| `SPECTRUM_SIGNING_SECRET` | for iMessage | returned once when registering the webhook (step 3) |
| `PUBLIC_URL` | recommended | the Vercel URL; included in "Done" replies and `dashboard` |
| `LLM_BUDGET_USD` | optional | default `5`; paid tiers stop when total spend reaches it |
| `WEB_COMMANDS_PER_MIN` | optional | default `20`; cap across all web-chat sessions |
| `FIRECRAWL_API_KEY`, `PROFILE_URL` | optional | live spec scrape; bundled fallback profile otherwise |

Generate a **production deploy key** in the Convex dashboard (Settings → Deploy keys) for Vercel.

## 2. Vercel (frontend)

Import the repo, framework preset **Vite**, then:

- Build command: `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL`
- Output directory: `dist`
- Env vars: `CONVEX_DEPLOY_KEY` (prod deploy key from step 1), `VITE_PHOTON_NUMBER` (the iMessage number shown on the banner/QR, e.g. `+1 (555) 123-4567`)

Each Vercel build pushes `convex/` to the prod deployment and bakes its URL into the frontend.
After the first deploy, set `PUBLIC_URL` in Convex to the Vercel URL.

## 3. Photon webhook

Webhook URL: `https://<your-prod-deployment>.convex.site/photon-webhook` (HTTP actions live on `.convex.site`, not `.convex.cloud`). Check it with `curl https://<deployment>.convex.site/health` → `ok`.

Register it ([docs](https://photon.codes/docs/webhooks/quickstart)):

```bash
curl -X POST "https://spectrum.photon.codes/projects/$PROJECT_ID/webhooks/" \
  -u "$PROJECT_ID:$PROJECT_SECRET" -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://<deployment>.convex.site/photon-webhook"}'
```

The response's `signingSecret` is shown **only once** → store it straight into Convex as `SPECTRUM_SIGNING_SECRET`.
Signature scheme ([docs](https://photon.codes/docs/webhooks/verifying-signatures)) is implemented and tested in `convex/lib/webhook.ts`.

## 4. Before the demo

1. Open `<PUBLIC_URL>/?admin=<ADMIN_KEY>` on the presenter laptop only. Press **Reset**.
2. Press **Auto-run 20 tasks** once (~60 s). This measures the 3-sample Opus baseline and teaches the transport/charge skills, so judges see `CACHE` hits and a "% saved" number immediately.
3. Text `status` from a real phone to the Photon number; expect a FREE reply. Text `move pallet from Dock A to Rack 3`; expect a robot to move and a ✅ reply.
4. Share only the plain URL (no `?admin=`) / QR with judges.

## 90-second script

1. (10 s) "Text a robot fleet, pay 90% less for its brain." Point at the QR.
2. (25 s) Judge texts `move pallet from Dock B to Rack 5` → robot moves in 3D, reply shows `Brain: CACHE · $0.0000 vs $0.0xxx baseline`.
3. (20 s) Judge texts `move 300 kg pallet from Dock B to Rack 2` → ⛔ blocked by the deterministic validator.
4. (20 s) Novel/risky request (`bring a fragile box from Dock C to Rack 1`) → escalates to the frontier brain. (`charge robot 4` is already a learned skill after the Auto-run warm-up.)
5. (15 s) Point at the cost chart / tier counts / skill library.
