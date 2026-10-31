import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../convex/_generated/api";

const TIER_STYLE: Record<string, string> = {
  FREE: "bg-slate-600 text-slate-100",
  CACHE: "bg-emerald-600 text-white",
  CHEAP: "bg-blue-600 text-white",
  FRONTIER: "bg-purple-600 text-white",
  BLOCKED: "bg-red-600 text-white",
  PENDING: "bg-slate-800 text-slate-300 animate-pulse",
};
const usd = (x: number | null | undefined, d = 4) => (x == null ? "—" : `$${x.toFixed(d)}`);

const FIRST_COMMAND = "move pumpkins from Dock A to Rack 3";
const smsLink = (n: string) => `sms:${n}&body=${encodeURIComponent(FIRST_COMMAND)}`;

function useJoin() {
  const register = useAction(api.photon.register);
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<{ busy?: boolean; number?: string; error?: string }>(() => {
    try {
      const n = localStorage.getItem("specbot-number");
      return n ? { number: n } : {};
    } catch {
      return {};
    }
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await register({ handle });
      if (r.ok) {
        setState({ number: r.number });
        try {
          localStorage.setItem("specbot-number", r.number);
        } catch {}
      } else setState({ error: r.error });
    } catch {
      setState({ error: "Couldn't reach Photon. Use the web chat on the big screen." });
    }
  };
  return { handle, setHandle, state, setState, submit };
}

function JoinForm({ j, big }: { j: ReturnType<typeof useJoin>; big?: boolean }) {
  return (
    <>
      <form onSubmit={j.submit} className={`flex gap-1 ${big ? "flex-col" : "mt-1"}`}>
        <input
          value={j.handle}
          onChange={(e) => j.setHandle(e.target.value)}
          type={big ? "tel" : "text"}
          autoComplete="tel"
          placeholder="+1 415 555 0123 or Apple ID email"
          className={`min-w-0 flex-1 rounded bg-white/90 px-2 text-slate-900 outline-none ${big ? "py-3 text-lg" : "py-1 text-sm"}`}
        />
        <button
          disabled={j.state.busy || !j.handle.trim()}
          className={`rounded bg-yellow-300 px-3 font-bold text-slate-900 disabled:opacity-50 ${big ? "py-3 text-lg" : "text-sm"}`}
        >
          {j.state.busy ? "Registering…" : "Get my number"}
        </button>
      </form>
      {j.state.error && <div className="mt-1 text-xs text-red-200">{j.state.error}</div>}
    </>
  );
}

/** Phone page behind the QR: register, then one tap opens iMessage with the first command prefilled. */
export function JoinPage() {
  const j = useJoin();
  return (
    <div className="flex min-h-screen flex-col justify-center gap-4 bg-gradient-to-b from-orange-600 via-purple-800 to-purple-950 p-5 text-white">
      <div className="text-xs uppercase tracking-widest text-orange-200">🎃 SpecBot Halloween Factory</div>
      <h1 className="text-3xl font-black leading-tight">Text a robot fleet over iMessage</h1>
      {j.state.number ? (
        <>
          <p className="text-purple-100">You're in. Your fleet number is</p>
          <div className="text-3xl font-black text-yellow-300">{j.state.number}</div>
          <a href={smsLink(j.state.number)} className="rounded-xl bg-green-500 py-4 text-center text-xl font-black text-white shadow-lg">
            📲 Text the fleet
          </a>
          <p className="text-sm text-purple-100">
            Opens iMessage with “{FIRST_COMMAND}”. Hit send, then watch your robot on the big screen.
          </p>
          <button onClick={() => j.setState({})} className="text-xs text-purple-300 underline">
            Use a different number
          </button>
        </>
      ) : (
        <>
          <p className="text-purple-100">Enter the number (with country code) or Apple ID email your iMessage sends from.</p>
          <JoinForm j={j} big />
        </>
      )}
    </div>
  );
}

export function Banner() {
  const j = useJoin();
  const joinUrl = `${location.origin}/?join`;
  return (
    <div className="flex shrink-0 items-center gap-4 rounded-xl bg-gradient-to-r from-orange-600 via-purple-700 to-purple-900 p-3">
      <a href={joinUrl} className="shrink-0 rounded bg-white p-1 text-center" title="Scan with your phone">
        <QRCodeSVG value={joinUrl} size={92} />
        <div className="text-[9px] font-bold text-slate-900">SCAN TO TEXT</div>
      </a>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-widest text-orange-200">🎃 SpecBot Halloween Factory · Text a robot fleet. Pay 90% less for its brain.</div>
        <div className="text-2xl font-black leading-tight">📱 Scan → register → text the fleet over iMessage</div>
        {j.state.number ? (
          <div className="text-sm text-purple-100">
            This browser is registered: text <span className="font-bold text-yellow-300">{j.state.number}</span>
          </div>
        ) : (
          <JoinForm j={j} />
        )}
      </div>
    </div>
  );
}

export function Counters() {
  const s = useQuery(api.tasks.stats);
  if (!s) return <div className="h-24 shrink-0" />;
  const box = (label: string, value: string, sub?: string, accent = "text-white") => (
    <div className="rounded-lg bg-slate-800/80 p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-black ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
  const lat = (t: string) => {
    const l = s.latency[t as keyof typeof s.latency];
    return l?.avgMs != null ? `${(l.avgMs / 1000).toFixed(1)}s` : "—";
  };
  return (
    <div className="sticky top-0 z-20 shrink-0 space-y-2 bg-slate-950 pb-2 shadow-lg shadow-slate-950">
      <div className="grid grid-cols-4 gap-2">
        {box("Robot tasks", String(s.tasks), `${s.freeCommands} free cmds`)}
        {box("Saved vs baseline", s.pctSaved != null ? `${s.pctSaved.toFixed(0)}%` : "…", s.baselineMeasured ? "baseline measured" : `measuring ${s.baselineSamples}/3`, "text-emerald-400")}
        {box("Spent / baseline", usd(s.spent, 3), `vs ${usd(s.baselineTotal, 3)}`)}
        {box("Cache hit rate", `${s.cacheHitRate.toFixed(0)}%`, `${s.latency.CACHE.count} hits`, "text-emerald-300")}
      </div>
      {s.baselineMeasured && s.perTaskBaseline != null && s.tasks > 0 && <ScaleProjection perTaskBaseline={s.perTaskBaseline} perTaskActual={s.spent / s.tasks} />}
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
        <span>Avg latency:</span>
        {(["FREE", "CACHE", "CHEAP", "FRONTIER"] as const).map((t) => (
          <span key={t}>
            <span className={`rounded px-1 ${TIER_STYLE[t]}`}>{t}</span> {lat(t)}
          </span>
        ))}
        <span className="text-slate-500">· baseline/task {usd(s.perTaskBaseline)} ({s.baselineMeasured ? "measured" : "measuring"})</span>
      </div>
    </div>
  );
}

const COMMANDS_PER_DAY = 10_000;
const big = (x: number) => (x >= 1000 ? `$${Math.round(x).toLocaleString("en-US")}` : `$${x.toFixed(x < 10 ? 2 : 0)}`);

/** Scales the measured per-task averages up to fleet volume so the gap is visible. */
function ScaleProjection({ perTaskBaseline, perTaskActual }: { perTaskBaseline: number; perTaskActual: number }) {
  const opusDay = perTaskBaseline * COMMANDS_PER_DAY;
  const oursDay = perTaskActual * COMMANDS_PER_DAY;
  const savedYear = (opusDay - oursDay) * 365;
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-emerald-300">At fleet scale: {COMMANDS_PER_DAY.toLocaleString("en-US")} commands / day</div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-white">
        <span className="text-lg text-purple-300 line-through decoration-2">{big(opusDay)}/day all-Opus</span>
        <span className="text-slate-400">→</span>
        <span className="text-2xl font-black text-emerald-400">{big(oursDay)}/day SpecBot</span>
        <span className="ml-auto text-lg font-black text-yellow-300">{big(savedYear)}/yr saved</span>
      </div>
      <div className="text-[10px] text-slate-400">
        Projected from tonight's measured averages: {usd(perTaskBaseline)} vs {usd(perTaskActual)} per command (real API token costs).
      </div>
    </div>
  );
}

export function CostChart() {
  const s = useQuery(api.tasks.stats);
  return (
    <div className="h-44 shrink-0 rounded-lg bg-slate-800/60 p-1">
      <ResponsiveContainer>
        <LineChart data={s?.series ?? []} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="n" stroke="#94a3b8" fontSize={10} />
          <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} width={44} />
          <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} contentStyle={{ background: "#0f172a", border: "none" }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="baseline" name="All-frontier baseline (measured)" stroke="#a855f7" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="actual" name="SpecBot actual" stroke="#22c55e" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type FeedRow = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.feed>>>[number];
type StepState = "chosen" | "miss" | "escalated" | "skipped" | "blocked" | "idle";
const STEP_LABEL = { FREE: "FREE", CACHE: "CACHE", CHEAP: "HAIKU", FRONTIER: "OPUS" } as const;

/** Reconstructs the router's path for one task from its tier + logged escalation reasons. */
function routeOf(t: FeedRow): { tier: keyof typeof STEP_LABEL; state: StepState; note?: string }[] {
  const r = t.reasons.filter(Boolean).join(" ").toLowerCase();
  const cheapTried = /low confidence|cheap model|validator:/.test(r);
  const cacheNote = /cached skill failed/.test(r) ? "skill unsafe here" : undefined;
  const why =
    t.reasons.filter(Boolean).find((x) => !/^validator: .{120,}/.test(x))?.replace(/^validator: /, "").slice(0, 70) ?? undefined;
  switch (t.tier) {
    case "FREE":
      return [{ tier: "FREE", state: "chosen", note: "no model needed" }];
    case "CACHE":
      return [
        { tier: "FREE", state: "miss" },
        { tier: "CACHE", state: "chosen", note: "learned skill reused" },
      ];
    case "CHEAP":
      return [
        { tier: "FREE", state: "miss" },
        { tier: "CACHE", state: "miss", note: "new phrasing" },
        { tier: "CHEAP", state: "chosen", note: "routine, confident" },
      ];
    case "FRONTIER":
    case "BLOCKED":
      return [
        { tier: "FREE", state: "miss" },
        { tier: "CACHE", state: cacheNote ? "escalated" : "miss", note: cacheNote },
        cheapTried ? { tier: "CHEAP", state: "escalated", note: why } : { tier: "CHEAP", state: "skipped", note: /baseline sample/.test(r) ? "baseline sample" : /risky/.test(r) ? "risky → straight to Opus" : undefined },
        { tier: "FRONTIER", state: t.tier === "BLOCKED" ? "blocked" : "chosen", note: t.tier === "BLOCKED" ? "refused: unsafe" : undefined },
      ];
    default:
      return [{ tier: "FREE", state: "idle", note: "thinking…" }];
  }
}

const STEP_STYLE: Record<StepState, string> = {
  chosen: "bg-emerald-500 text-white ring-2 ring-emerald-300",
  miss: "bg-slate-700 text-slate-400 line-through",
  escalated: "bg-amber-600/80 text-white",
  skipped: "bg-slate-800 text-slate-500 border border-dashed border-slate-600",
  blocked: "bg-red-600 text-white ring-2 ring-red-300",
  idle: "bg-slate-800 text-slate-400 animate-pulse",
};

function SavingsBar({ cost, baseline, blocked }: { cost: number; baseline: number | null; blocked: boolean }) {
  if (baseline == null) return <div className="text-[11px] text-slate-500">baseline still being measured…</div>;
  const pct = Math.max(0, Math.min(1, cost / baseline));
  const saved = baseline - cost;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-purple-900/60" title={`All-Opus baseline ${usd(baseline)}`}>
        <div className={`h-full ${blocked ? "bg-red-500" : "bg-emerald-400"}`} style={{ width: `${Math.max(pct * 100, cost > 0 ? 2 : 0)}%` }} />
      </div>
      <div className="w-40 shrink-0 text-right text-[11px]">
        {saved >= 0 ? (
          <span className="font-bold text-emerald-300">
            saved {usd(saved)} ({Math.round((saved / baseline) * 100)}%)
          </span>
        ) : (
          <span className="font-bold text-amber-300">+{usd(-saved)} (hard case)</span>
        )}
      </div>
    </div>
  );
}

export function Feed() {
  const rows = useQuery(api.tasks.feed);
  const stats = useQuery(api.tasks.stats);
  const baseline = stats?.baselineMeasured ? stats.perTaskBaseline : null;
  return (
    <div className="h-full space-y-1.5 overflow-y-auto pr-1">
      {(rows ?? []).map((t) => (
        <div key={t._id} className={`rounded-lg p-2 text-sm ${t.source === "imessage" ? "bg-blue-950/70 ring-1 ring-blue-500/50" : "bg-slate-800/70"}`}>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TIER_STYLE[t.tier] ?? ""}`}>{t.tier === "PENDING" ? "THINKING" : t.tier}</span>
            <span className="text-slate-300">{t.source === "imessage" ? "💬 iMessage" : t.source === "autorun" ? "⚙️ auto" : "🌐 web"}</span>
            <span className="text-slate-500">{t.senderMasked}</span>
            <span className="ml-auto text-slate-400">
              {usd(t.costUsd)} · {(t.latencyMs / 1000).toFixed(1)}s · {t.status}
            </span>
          </div>
          <div className="mt-0.5 font-medium text-slate-50">“{t.text}”</div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            {routeOf(t).map((st, i) => (
              <span key={st.tier} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-500">→</span>}
                <span className={`rounded px-1.5 py-0.5 font-bold ${STEP_STYLE[st.state]}`}>
                  {st.state === "blocked" ? "⛔ " : st.state === "chosen" ? "✓ " : ""}
                  {STEP_LABEL[st.tier]}
                </span>
                {st.note && (st.state !== "miss" || st.tier === "CACHE") && <span className="text-slate-400">{st.note}</span>}
              </span>
            ))}
          </div>
          {t.tier !== "FREE" && t.tier !== "PENDING" && (
            <div className="mt-1">
              <SavingsBar cost={t.costUsd} baseline={baseline} blocked={t.tier === "BLOCKED"} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Skills() {
  const skills = useQuery(api.tasks.skills);
  return (
    <div className="space-y-1 text-xs">
      {(skills ?? []).length === 0 && <div className="text-slate-500">No skills yet. Frontier plans get saved here.</div>}
      {(skills ?? []).map((s) => (
        <div key={s._id} className="flex items-center gap-2 rounded bg-slate-800/70 px-2 py-1">
          <span className="font-mono text-emerald-300">{s.key}</span>
          <span className="truncate text-slate-400">e.g. “{s.example}”</span>
          <span className="ml-auto shrink-0 text-slate-300">
            {s.hits} hits · from {s.learnedFrom}
          </span>
        </div>
      ))}
    </div>
  );
}

function sessionId() {
  try {
    let id = localStorage.getItem("specbot-session");
    if (!id) localStorage.setItem("specbot-session", (id = `web-${crypto.randomUUID().slice(0, 8)}`));
    return id;
  } catch {
    return `web-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function Chat() {
  const [session] = useState(sessionId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = useAction(api.router.webCommand);
  const autorun = useAction(api.router.autorun);
  const reset = useMutation(api.admin.reset);
  const refreshProfile = useAction(api.profile.refresh);
  const [scraping, setScraping] = useState(false);
  const mine = useQuery(api.tasks.bySession, { session });
  const end = useRef<HTMLDivElement>(null);
  const adminKey = new URLSearchParams(location.search).get("admin");
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [mine]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const t = text;
    setText("");
    try {
      await send({ text: t, session });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex-1 space-y-1 overflow-y-auto text-xs">
        {(mine ?? []).map((t) => (
          <div key={t._id} className="space-y-1">
            <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-blue-600 px-2 py-1">{t.text}</div>
            {t.replies.map((r, i) => (
              <div key={i} className="w-fit max-w-[90%] whitespace-pre-wrap rounded-lg bg-slate-700 px-2 py-1">
                {r}
              </div>
            ))}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Web fallback: move pallet from Dock A to Rack 3"
          className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-sm outline-none ring-blue-500 focus:ring-1"
        />
        <button disabled={busy} className="rounded bg-blue-600 px-3 text-sm font-bold disabled:opacity-50">
          Send
        </button>
      </form>
      <div className="flex gap-1">
        <button onClick={async () => { const r = await autorun({}); if (!r.started) alert(`Queue already has ${r.queued} tasks. Let it drain first.`); }} className="flex-1 rounded bg-slate-700 py-1 text-xs hover:bg-slate-600">
          ▶ Auto-run 20 tasks
        </button>
        {adminKey && (
          <button
            disabled={scraping}
            onClick={async () => {
              setScraping(true);
              try {
                const r = await refreshProfile({ adminKey });
                if (r.source !== "firecrawl") alert(`Firecrawl failed, kept fallback profile: ${"error" in r ? r.error : ""}`);
              } finally {
                setScraping(false);
              }
            }}
            className="rounded bg-orange-700 px-3 py-1 text-xs hover:bg-orange-600 disabled:opacity-50"
          >
            {scraping ? "Scraping…" : "🔥 Firecrawl spec"}
          </button>
        )}
        {adminKey && (
          <button
            onClick={() => confirm("Reset everything?") && reset({ adminKey })}
            className="rounded bg-red-800 px-3 py-1 text-xs hover:bg-red-700"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
