import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseInboundText, verifySpectrumSignature } from "./lib/webhook";

// Photon Spectrum webhook (see lib/webhook.ts for the spec links).
const photonWebhook = httpAction(async (ctx, req) => {
  const rawBody = await req.text();
  const v = await verifySpectrumSignature(
    process.env.SPECTRUM_SIGNING_SECRET,
    req.headers.get("x-spectrum-timestamp"),
    req.headers.get("x-spectrum-signature"),
    rawBody,
  );
  if (!v.ok) return new Response(v.error, { status: v.status });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const msg = parseInboundText(payload);
  if (!msg) return new Response("ignored", { status: 200 });

  // at-least-once delivery: dedupe on message.id
  const fresh = await ctx.runMutation(internal.fleet.markInbound, { messageId: msg.messageId });
  if (fresh) {
    await ctx.scheduler.runAfter(0, internal.router.handleCommand, {
      source: "imessage",
      sender: msg.sender,
      text: msg.text,
    });
  }
  return new Response("ok", { status: 200 });
});

const http = httpRouter();
http.route({ path: "/photon-webhook", method: "POST", handler: photonWebhook });
http.route({ path: "/health", method: "GET", handler: httpAction(async () => new Response("ok")) });
export default http;
