import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../convex/_generated/api";
import { Sim } from "./Sim";
import { setServerOffset } from "./clock";

const PHOTON_NUMBER = (import.meta.env.VITE_PHOTON_NUMBER as string | undefined) ?? "+1 (555) 010-0000";
const QR_COMMAND = "move pallet from Dock A to Rack 3";

const TIER_STYLE: Record<string, string> = {
  FREE: "bg-gray-600/30 text-gray-200 border-gray-500/50",
  CACHE: "bg-green-600/25 text-green-300 border-green-500/50",
  CHEAP: "bg-blue-600/25 text-blue-300 border-blue-500/50",
  FRONTIER: "bg-purple-600/25 text-purple-300 border-purple-500/50",
  BLOCKED: "bg-red-600/25 text-red-300 border-red-500/50",
};

const usd = (n: number | null | undefined, d = 4) => (n == null ? "—" : `$${n.toFixed(d)}`);

function sessionId() {
  try {
    let s = localStorage.getItem("specbot-session");
    if (!s) {
      s = "web-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("specbot-session", s);
    }
    return s;
  } catch {
    return "web-" + Math.random().toString(36).slice(2, 10);
  }
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

function Banner() {
  const digits = PHOTON_NUMBER.replace(/[^\d+]/g, "");
  const smsHref = `sms:${digits}&body=${encodeURIComponent(QR_COMMAND)}`;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-purple-900/40 via-blue-900/30 to-green-900/30 px-5 py-3">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-gray-300">SpecBot Text · Text a robot fleet. Pay 90% less for its brain.</div>
        <div className="mt-1 text-2xl font-extrabold md:text-3xl">
          📱 Text <a href={smsHref} className="text-green-300 underline decoration-dotted">{PHOTON_NUMBER}</a> to command the fleet
        </div>
        <div className="text-sm text-gray-300">Try: “{QR_COMMAND}” · “status” · “charge robot 4” · “move 300 kg pallet from Dock B to Rack 2”</div>
      </div>
      <a href={smsHref} className="hidden shrink-0 rounded-lg bg-white p-1.5 sm:block" title="Scan to open iMessage">
        <QRCodeSVG value={smsHref} size={92} />
      </a>
    </div>
  );
}

function Chat({ sid, adminKey }: { sid: string; adminKey: string | null }) {
  const send = useAction(api.router.sendWeb);
  const auto = useAction(api.router.autoRun);
  const replies = useQuery(api.dashboard.myReplies, { sessionId: sid }) ?? [];
  const cmds = useQuery(api.dashboard.myCommands, { sessionId: sid }) ?? [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; createdAt: number }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const seen = new Set(cmds.map((c) => c.text));
    return [
      ...cmds.map((c) => ({ me: true, text: c.text, t: c.createdAt })),
      ...pending.filter((p) => !seen.has(p.text)).map((p) => ({ me: true, text: p.text, t: p.createdAt })),
      ...replies.map((r) => ({ me: false, text: r.text, t: r.createdAt })),
    ].sort((a, b) => a.t - b.t).slice(-40);
  }, [cmds, replies, pending]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [items.length]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setBusy(true);
    setPending((p) => [...p, { text: t, createdAt: Date.now() }]);
    setError(null);
    try {
      await send({ sessionId: sid, text: t });
    } catch {
      setError("Couldn't reach the fleet. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="text-sm font-semibold">💻 Web chat (same brain as iMessage)</div>
        {adminKey && (
          <button
            onClick={() => {
              setError(null);
              auto({ sessionId: sid, adminKey }).catch((e: Error) => setError(`Auto-run: ${e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]}`));
            }}
            className="rounded-md bg-purple-600 px-2.5 py-1 text-xs font-semibold hover:bg-purple-500"
          >
            ▶ Auto-run 20 tasks
          </button>
        )}
      </div>
      <div ref={box} className="h-48 space-y-1.5 overflow-y-auto p-3 text-sm">
        {items.length === 0 && <div className="text-gray-500">Type a command, e.g. “move pallet from Dock A to Rack 3”.</div>}
        {items.map((m, i) => (
          <div key={i} className={`flex ${m.me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 ${m.me ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-100"}`}>{m.text}</div>
          </div>
        ))}
      </div>
      {error && <div className="border-t border-white/10 px-3 py-1.5 text-xs text-amber-300">{error}</div>}
      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Command the fleet…"
          className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button disabled={busy} className="rounded-lg bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50">
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const ping = useMutation(api.fleet.ping);
  const init = useMutation(api.fleet.init);
  const reset = useMutation(api.fleet.reset);
  const refreshProfile = useAction(api.profileScrape.refresh);
  const state = useQuery(api.fleet.state);
  const summary = useQuery(api.dashboard.summary);
  const feed = useQuery(api.dashboard.feed) ?? [];
  const skills = useQuery(api.dashboard.skills) ?? [];
  const sid = useMemo(sessionId, []);
  const adminKey = useMemo(() => new URLSearchParams(location.search).get("admin"), []);

  useEffect(() => {
    const sync = async () => {
      const t0 = Date.now();
      const s = await ping();
      const t1 = Date.now();
      setServerOffset(s - (t0 + t1) / 2);
    };
    void init();
    void sync();
    const i = setInterval(sync, 30000);
    return () => clearInterval(i);
  }, [ping, init]);

  const s = summary;
  return (
    <div className="flex h-full flex-col">
      <Banner />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[45vh] lg:h-auto lg:w-[55%]">
          {state && <Sim robots={state.robots} stepMs={state.stepMs} />}
          <div className="pointer-events-none absolute left-3 top-3 space-y-1 text-xs text-gray-300">
            <div><span className="text-green-400">●</span> idle <span className="ml-2 text-blue-400">●</span> busy <span className="ml-2 text-yellow-300">●</span> charging <span className="ml-2 text-red-400">■</span> human zone</div>
            {state && (
              <div className="text-gray-400">
                Profile ({state.profile.source}): {state.profile.data.model_name} · max {state.profile.data.max_payload_kg} kg · {state.profile.data.max_speed_mps} m/s
              </div>
            )}
          </div>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-3 lg:w-[45%]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Tasks" value={String(s?.tasks ?? 0)} />
            <Stat
              label="Saved vs baseline"
              value={s?.savedPct != null ? `${s.savedPct.toFixed(1)}%` : "—"}
              sub={s?.baselinePerTask != null ? "baseline: measured" : `measuring baseline ${s?.baselineSamples ?? 0}/${s?.baselineNeeded ?? 3}`}
              accent="text-green-300"
            />
            <Stat label="Spent / baseline" value={`${usd(s?.actualUsd, 3)}`} sub={`vs ${usd(s?.baselineUsd, 3)} all-frontier`} />
            <Stat label="Cache hit rate" value={`${Math.round((s?.cacheHitRate ?? 0) * 100)}%`} sub="of robot commands" accent="text-green-300" />
            <Stat label="Baseline / task" value={usd(s?.baselinePerTask)} sub="avg of first 3 frontier runs" accent="text-purple-300" />
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-400">Avg latency / tier</div>
              <div className="mt-1 space-y-0.5 text-xs tabular-nums">
                {["FREE", "CACHE", "CHEAP", "FRONTIER", "BLOCKED"].map((t) => (
                  <div key={t} className="flex justify-between">
                    <span className="text-gray-400">{t} ({s?.tierCount[t] ?? 0})</span>
                    <span>{s?.avgLatency[t] != null ? `${(s.avgLatency[t] / 1000).toFixed(2)}s` : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="h-48 rounded-xl border border-white/10 bg-white/[0.03] p-2">
            <div className="px-1 text-xs text-gray-400">Cumulative cost: actual vs all-frontier baseline</div>
            <ResponsiveContainer width="100%" height="88%">
              <LineChart data={s?.series ?? []}>
                <CartesianGrid stroke="#1f2937" />
                <XAxis dataKey="n" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => `$${v}`} width={52} />
                <Tooltip contentStyle={{ background: "#0b1020", border: "1px solid #334155" }} formatter={(v) => `$${Number(v).toFixed(4)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="baseline" name="all-frontier baseline" stroke="#a855f7" dot={false} strokeDasharray="5 4" isAnimationActive={false} />
                <Line type="monotone" dataKey="actual" name="SpecBot actual" stroke="#22c55e" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <Chat sid={sid} adminKey={adminKey} />

          <div className="rounded-xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 px-3 py-2 text-sm font-semibold">Live feed</div>
            <div className="max-h-80 divide-y divide-white/5 overflow-y-auto">
              {feed.map((t) => (
                <div key={t.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${TIER_STYLE[t.tier] ?? TIER_STYLE.FREE}`}>{t.tier}</span>
                    <span className="text-xs text-gray-400">{t.source === "imessage" ? "📱 iMessage" : "💻 web"} · {t.who}</span>
                    <span className="ml-auto text-xs tabular-nums text-gray-400">
                      {usd(t.costUsd)} · {(t.latencyMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <div className="mt-0.5 text-gray-100">“{t.text}”</div>
                  <div className="text-[11px] text-gray-500">
                    {t.outcome}
                    {t.robots.length ? ` · robot ${t.robots.join("+")}` : ""}
                    {t.model ? ` · ${t.model}` : ""}
                    {t.tokens.in + t.tokens.out > 0 ? ` · ${t.tokens.in} in / ${t.tokens.out} out / ${t.tokens.cacheRead} cached` : ""}
                    {t.isBaseline ? " · baseline sample" : ""}
                  </div>
                  {t.reason && <div className="text-[11px] text-amber-300/80">↳ {t.reason}</div>}
                </div>
              ))}
              {feed.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No tasks yet — text the number above.</div>}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 px-3 py-2 text-sm font-semibold">🧠 Skill library ({skills.length})</div>
            <div className="divide-y divide-white/5">
              {skills.map((k) => (
                <div key={k.name} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <div>
                    <span className="font-mono text-green-300">{k.name}</span>
                    <span className="ml-2 text-xs text-gray-500">learned from {k.learnedFrom}: “{k.example}”</span>
                  </div>
                  <span className="text-xs tabular-nums text-gray-400">{k.hits} hits · $0</span>
                </div>
              ))}
              {skills.length === 0 && <div className="px-3 py-3 text-xs text-gray-500">Frontier plans become reusable $0 skills here.</div>}
            </div>
          </div>

          {adminKey && (
            <div className="flex gap-2">
              <button
                onClick={() => confirm("Reset all tasks, skills and metrics?") && reset({ adminKey })}
                className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold"
              >
                Reset
              </button>
              <button onClick={() => refreshProfile({ adminKey }).then((r) => alert(`Profile: ${r.source}`))} className="rounded-md bg-gray-700 px-3 py-1.5 text-xs font-semibold">
                Re-scrape robot profile (Firecrawl)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
