import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Photon 2.0 webhook destination. The signing scheme isn't documented yet, so instead of trusting the
// payload we only take its message id and re-fetch the message from Photon's API with our key
// (photon.inbound). Forged deliveries therefore can't inject commands. Headers are logged for later HMAC checks.
http.route({
  path: "/photon/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (body?.type !== "message.received") return new Response("ignored", { status: 200 });
    const messageId = body?.data?.object?.id;
    if (typeof messageId !== "string" || messageId.length > 200) return new Response("no message id", { status: 200 });
    const sigHeaders = [...req.headers.entries()].filter(([k]) => /sig|webhook|photon|timestamp/i.test(k)).map(([k]) => k);
    console.log("photon webhook", body.id, messageId, "headers:", sigHeaders.join(","));

    const fresh = await ctx.runMutation(internal.tasks.dedupe, { messageId });
    if (!fresh) return new Response("duplicate", { status: 200 });
    // Ack fast; verification + routing happen asynchronously.
    await ctx.scheduler.runAfter(0, internal.photon.inbound, { messageId });
    return new Response("ok", { status: 200 });
  }),
});

http.route({ path: "/health", method: "GET", handler: httpAction(async () => new Response("ok")) });

export default http;
