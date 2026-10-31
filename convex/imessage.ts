"use node";
// Outbound iMessage via Photon Spectrum. Photon has no HTTP send endpoint today;
// the documented path is the spectrum-ts SDK: im.user(id) -> im.space.create(user) -> space.send().
import { v } from "convex/values";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { internalAction } from "./_generated/server";

type App = Awaited<ReturnType<typeof Spectrum>>;
let appPromise: Promise<App> | null = null;

function getApp() {
  appPromise ??= Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID!,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
    providers: [imessage.config()],
  }).catch((e) => {
    appPromise = null;
    throw e;
  });
  return appPromise;
}

async function sendOnce(to: string, text: string) {
  const im = imessage(await getApp());
  const user = await im.user(to);
  const space = await im.space.create(user);
  await space.send(text);
}

export const send = internalAction({
  args: { to: v.string(), text: v.string() },
  handler: async (_ctx, { to, text }) => {
    if (!process.env.SPECTRUM_PROJECT_ID) {
      console.warn("SPECTRUM_PROJECT_ID not set; skipping iMessage send", to, text);
      return;
    }
    try {
      await sendOnce(to, text);
    } catch (e) {
      console.warn("iMessage send failed, retrying with a fresh client", e);
      appPromise = null;
      await sendOnce(to, text);
    }
  },
});
