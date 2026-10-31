"use node";
// Photon 2.0 (Beta) REST API, per https://api.photon.codes/openapi.json:
//   POST /v1/projects/{id}/messages                         sendMessage (idempotency-key)
//   GET  /v1/projects/{id}/messages/{messageId}             getMessage (used to verify webhook deliveries)
//   POST /v1/projects/{id}/platforms/imessage/assignments   createSharedLineAssignment (Idempotency-Key)
//   POST /v1/projects/{projectId}/webhooks/destinations     createWebhookDestination
import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { Plan } from "../shared/types";

const BASE = "https://api.photon.codes/v1";
const pid = () => process.env.PHOTON_PROJECT_ID ?? "";

async function photon(method: string, path: string, body?: unknown, idemKey?: string) {
  const res = await fetch(`${BASE}/projects/${pid()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PHOTON_API_KEY}`,
      "Content-Type": "application/json",
      ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

export async function photonSend(spaceId: string, senderId: string, text: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await photon("POST", "/messages", { spaceId, senderId, content: { type: "text", format: "plain", text } }, randomUUID());
    if (r.ok) return;
    console.error(`photon send failed (${r.status})`, JSON.stringify(r.json).slice(0, 500));
    if (r.status < 500 && r.status !== 429) return;
  }
}

/** Record a reply on the task (for the web chat/feed) and text it if the sender is on iMessage. */
export async function deliver(ctx: ActionCtx, a: { contactId?: Id<"contacts">; taskId?: Id<"tasks">; text: string }) {
  if (a.taskId) await ctx.runMutation(internal.tasks.appendReply, { id: a.taskId, text: a.text });
  if (!a.contactId) return;
  const c = await ctx.runQuery(internal.tasks.getContact, { id: a.contactId });
  if (c?.source !== "imessage" || !c.spaceId || !c.agentId) return;
  try {
    await photonSend(c.spaceId, c.agentId, a.text);
  } catch (e) {
    console.error("photon send threw", e);
  }
}

/** Webhook follow-up: re-fetch the message from Photon with our API key, so only real messages are acted on. */
export const inbound = internalAction({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) => {
    const r = await photon("GET", `/messages/${encodeURIComponent(messageId)}`);
    if (!r.ok) {
      console.error(`getMessage ${messageId} failed (${r.status})`, JSON.stringify(r.json).slice(0, 300));
      return;
    }
    const m = r.json?.message ?? r.json;
    if (m?.platform !== "imessage" || m?.status !== "received" || m?.projectId !== pid()) return;
    if (m.sentBy?.kind === "agent") return;
    const sender: string | undefined = m.sentBy?.handle;
    const spaceId: string | undefined = m.space?.id;
    const agentId: string | undefined = m.receivedBy?.id ?? m.addressedTo?.id;
    if (!sender || !spaceId || !agentId) {
      console.error("inbound message missing fields", JSON.stringify(m).slice(0, 500));
      return;
    }
    const text = m.content?.type === "text" ? String(m.content.text ?? "") : "help";
    await ctx.runAction(internal.router.handleCommand, { source: "imessage", senderKey: sender, spaceId, agentId, text: text || "help" });
  },
});

/** Public: a judge enters their phone/Apple ID email, we assign them a Photon shared line. */
export const register = action({
  args: { handle: v.string() },
  handler: async (_ctx, { handle }) => {
    let h = handle.trim();
    if (!h.includes("@")) {
      h = h.replace(/[^\d+]/g, "");
      if (!h.startsWith("+")) h = h.length === 10 ? `+1${h}` : `+${h}`;
      if (!/^\+[1-9]\d{6,14}$/.test(h)) return { ok: false as const, error: "Enter a phone number with country code, e.g. +1 415 555 0123, or your Apple ID email." };
    } else if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(h)) return { ok: false as const, error: "That email doesn't look right." };
    const key = createHash("sha256").update(`assign:${h.toLowerCase()}`).digest("hex").slice(0, 32);
    const r = await photon("POST", "/platforms/imessage/assignments", { handle: h }, key);
    if (r.ok && r.json?.assignedPhoneNumber) return { ok: true as const, number: r.json.assignedPhoneNumber as string };
    if (r.status === 409) {
      const list = await photon("GET", "/platforms/imessage/assignments");
      const found = (list.json?.assignments ?? []).find((a: any) => String(a.handle).toLowerCase() === h.toLowerCase() && !a.releasedAt);
      if (found) return { ok: true as const, number: found.assignedPhoneNumber as string };
    }
    console.error(`assignment failed (${r.status})`, JSON.stringify(r.json).slice(0, 400));
    return { ok: false as const, error: r.json?.detail ?? r.json?.title ?? `Photon returned ${r.status}` };
  },
});

/** Admin: npx convex run photon:registerWebhook '{"url":"https://<deployment>.convex.site/photon/webhook"}' */
export const registerWebhook = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    const r = await fetch(`${BASE}/projects/${pid()}/webhooks/destinations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PHOTON_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ name: "specbot", url, apiVersion: "2026-07-01", enabledEvents: ["message.received"] }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  },
});

const siteUrl = () => process.env.SITE_URL ?? "";

function doneText(plan: Plan | undefined, robotNums: number[], target?: string) {
  const steps = plan?.assignments.flatMap((a) => a.steps) ?? [];
  const pick = steps.find((s) => s.action === "pick");
  const drops = plan?.assignments.map((a) => [...a.steps].reverse().find((s) => s.action === "move_to")?.target).filter(Boolean) ?? [];
  const what = pick ? `${cap(pick.item ?? "load")} delivered to ${[...new Set(drops)].join(" & ")}` : steps.some((s) => s.action === "charge") ? `Robot ${robotNums.join(", ")} charged` : `Robot ${robotNums.join(" + ")} reached ${target}`;
  return `✅ Done. ${what}. Watch live: ${siteUrl()}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const notifyDone = internalAction({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const t = await ctx.runQuery(internal.tasks.getTask, { id: taskId });
    if (!t) return;
    await deliver(ctx, { contactId: t.contactId, taskId, text: doneText(t.plan, t.robotNums, t.target) });
  },
});

export const notifyStarted = internalAction({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const t = await ctx.runQuery(internal.tasks.getTask, { id: taskId });
    if (!t || !t.etaAt) return;
    const eta = Math.max(1, Math.round((t.etaAt - Date.now()) / 1000));
    await deliver(ctx, { contactId: t.contactId, taskId, text: `🤖 Your turn! Robot ${t.robotNums.join(" + ")} on it → ${t.target} (~${eta}s).` });
  },
});
