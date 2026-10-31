// Photon Spectrum webhook verification + parsing (pure, unit-tested).
// Spec: https://photon.codes/docs/webhooks/verifying-signatures
//   X-Spectrum-Signature = "v0=" + lowercase hex(HMAC-SHA256(secret, `v0:${timestamp}:${rawBody}`))
//   X-Spectrum-Timestamp = unix seconds; reject if more than 5 minutes off.
// Payload: https://photon.codes/docs/webhooks/events  ({ event: "messages", space, message })
export const TOLERANCE_SEC = 5 * 60;

export async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type VerifyResult = { ok: true } | { ok: false; status: 400 | 401 | 500; error: string };

export async function verifySpectrumSignature(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!secret) return { ok: false, status: 500, error: "webhook secret not configured" };
  if (!timestamp || !signature) return { ok: false, status: 400, error: "missing headers" };
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSec - Number(timestamp)) > TOLERANCE_SEC)
    return { ok: false, status: 400, error: "stale timestamp" };
  const expected = "v0=" + (await hmacHex(secret, `v0:${timestamp}:${rawBody}`));
  if (!safeEqual(expected, signature)) return { ok: false, status: 401, error: "bad signature" };
  return { ok: true };
}

export type InboundText = { messageId: string; sender: string; text: string };

// Returns null for anything we don't act on (non-text content, reactions, attachments, unknown events).
export function parseInboundText(payload: unknown): InboundText | null {
  const p = payload as {
    event?: string;
    message?: { id?: unknown; direction?: string; sender?: { id?: unknown }; content?: { type?: string; text?: unknown } };
  } | null;
  const msg = p?.message;
  if (p?.event !== "messages" || msg?.direction !== "inbound" || msg.content?.type !== "text") return null;
  if (msg.id == null || msg.sender?.id == null) return null;
  return { messageId: String(msg.id), sender: String(msg.sender.id), text: String(msg.content.text ?? "") };
}
