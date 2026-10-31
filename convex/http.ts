import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Photon Spectrum webhook. Signature: X-Spectrum-Signature = "v0=" + hex(HMAC-SHA256(secret, `v0:${ts}:${rawBody}`)).
const TOLERANCE_SEC = 5 * 60;

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const photonWebhook = httpAction(async (ctx, req) => {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-spectrum-timestamp");
  const signature = req.headers.get("x-spectrum-signature");
  const secret = process.env.SPECTRUM_SIGNING_SECRET;
  if (!secret) return new Response("webhook secret not configured", { status: 500 });
  if (!timestamp || !signature) return new Response("missing headers", { status: 400 });
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return new Response("stale timestamp", { status: 400 });
  const expected = "v0=" + (await hmacHex(secret, `v0:${timestamp}:${rawBody}`));
  if (!safeEqual(expected, signature)) return new Response("bad signature", { status: 401 });

  const payload = JSON.parse(rawBody);
  const msg = payload?.message;
  if (payload?.event !== "messages" || msg?.direction !== "inbound" || msg?.content?.type !== "text") {
    return new Response("ignored", { status: 200 });
  }
  // at-least-once delivery: dedupe on message.id
  const fresh = await ctx.runMutation(internal.fleet.markInbound, { messageId: String(msg.id) });
  if (fresh) {
    await ctx.scheduler.runAfter(0, internal.router.handleCommand, {
      source: "imessage",
      sender: String(msg.sender?.id ?? payload.space?.id),
      text: String(msg.content.text ?? ""),
    });
  }
  return new Response("ok", { status: 200 });
});

const http = httpRouter();
http.route({ path: "/photon-webhook", method: "POST", handler: photonWebhook });
http.route({ path: "/health", method: "GET", handler: httpAction(async () => new Response("ok")) });
export default http;
