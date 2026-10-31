import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInboundText, verifySpectrumSignature } from "../convex/lib/webhook";

const SECRET = "test-signing-secret";
const NOW = 1_800_000_000;

// Independent reference implementation of Photon's documented scheme.
const sign = (ts: string, body: string, secret = SECRET) =>
  "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

// Shape from https://photon.codes/docs/webhooks/events (illustrative values).
const inbound = {
  event: "messages",
  space: { id: "any;-;+15550199", platform: "iMessage", type: "dm", phone: "+15551230000" },
  message: {
    id: "spc-msg-1",
    platform: "iMessage",
    direction: "inbound",
    timestamp: "2026-01-01T12:00:00.000Z",
    sender: { id: "+15550199", platform: "iMessage" },
    space: { id: "any;-;+15550199", platform: "iMessage", type: "dm", phone: "+15551230000" },
    content: { type: "text", text: "move pallet from Dock A to Rack 3" },
  },
};

describe("verifySpectrumSignature", () => {
  const body = JSON.stringify(inbound);
  const ts = String(NOW);

  it("accepts a correctly signed delivery", async () => {
    expect(await verifySpectrumSignature(SECRET, ts, sign(ts, body), body, NOW)).toEqual({ ok: true });
  });

  it("rejects a tampered body with 401", async () => {
    const r = await verifySpectrumSignature(SECRET, ts, sign(ts, body), body.replace("Rack 3", "Rack 4"), NOW);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a signature made with another secret", async () => {
    const r = await verifySpectrumSignature(SECRET, ts, sign(ts, body, "other"), body, NOW);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects timestamps outside the 5 minute window with 400", async () => {
    const old = String(NOW - 301);
    expect(await verifySpectrumSignature(SECRET, old, sign(old, body), body, NOW)).toMatchObject({ ok: false, status: 400 });
    const edge = String(NOW - 300);
    expect(await verifySpectrumSignature(SECRET, edge, sign(edge, body), body, NOW)).toEqual({ ok: true });
  });

  it("rejects millisecond or non-numeric timestamps", async () => {
    const ms = String(NOW * 1000);
    expect(await verifySpectrumSignature(SECRET, ms, sign(ms, body), body, NOW)).toMatchObject({ status: 400 });
    expect(await verifySpectrumSignature(SECRET, "abc", sign("abc", body), body, NOW)).toMatchObject({ status: 400 });
  });

  it("returns 400 on missing headers and 500 when no secret is configured", async () => {
    expect(await verifySpectrumSignature(SECRET, null, sign(ts, body), body, NOW)).toMatchObject({ status: 400 });
    expect(await verifySpectrumSignature(SECRET, ts, null, body, NOW)).toMatchObject({ status: 400 });
    expect(await verifySpectrumSignature(undefined, ts, sign(ts, body), body, NOW)).toMatchObject({ status: 500 });
  });
});

describe("parseInboundText", () => {
  it("extracts id, sender and text from an inbound text message", () => {
    expect(parseInboundText(inbound)).toEqual({
      messageId: "spc-msg-1",
      sender: "+15550199",
      text: "move pallet from Dock A to Rack 3",
    });
  });

  it("ignores attachments, reactions, other events and malformed payloads", () => {
    const attach = { ...inbound, message: { ...inbound.message, content: { type: "attachment", id: "a", name: "x.png", mimeType: "image/png" } } };
    expect(parseInboundText(attach)).toBeNull();
    expect(parseInboundText({ ...inbound, event: "other" })).toBeNull();
    expect(parseInboundText({ ...inbound, message: { ...inbound.message, direction: "outbound" } })).toBeNull();
    expect(parseInboundText({ ...inbound, message: { ...inbound.message, sender: undefined } })).toBeNull();
    expect(parseInboundText(null)).toBeNull();
  });
});
