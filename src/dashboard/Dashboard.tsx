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

const FIRST_COMMAND = "move pallet from Dock A to Rack 3";
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
    <div className="flex min-h-screen flex-col justify-center gap-4 bg-gradient-to-b from-purple-800 to-blue-900 p-5 text-white">
      <div className="text-xs uppercase tracking-widest text-purple-200">SpecBot Text</div>
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
    <div className="flex shrink-0 items-center gap-4 rounded-xl bg-gradient-to-r from-purple-700 to-blue-700 p-3">
      <a href={joinUrl} className="shrink-0 rounded bg-white p-1 text-center" title="Scan with your phone">
        <QRCodeSVG value={joinUrl} size={92} />
        <div className="text-[9px] font-bold text-slate-900">SCAN TO TEXT</div>
      </a>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-widest text-purple-200">SpecBot Text · Text a robot fleet. Pay 90% less for its brain.</div>
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
    <div className="shrink-0 space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {box("Robot tasks", String(s.tasks), `${s.freeCommands} free cmds`)}
        {box("Saved vs baseline", s.pctSaved != null ? `${s.pctSaved.toFixed(0)}%` : "…", s.baselineMeasured ? "baseline measured" : `measuring ${s.baselineSamples}/3`, "text-emerald-400")}
        {box("Spent / baseline", usd(s.spent, 3), `vs ${usd(s.baselineTotal, 3)}`)}
        {box("Cache hit rate", `${s.cacheHitRate.toFixed(0)}%`, `${s.latency.CACHE.count} hits`, "text-emerald-300")}
      </div>
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

export function Feed() {
  const rows = useQuery(api.tasks.feed);
  return (
    <div className="h-full space-y-1 overflow-y-auto pr-1">
      {(rows ?? []).map((t) => (
        <div key={t._id} className="rounded bg-slate-800/70 p-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_STYLE[t.tier] ?? ""}`}>{t.tier === "PENDING" ? "THINKING" : t.tier}</span>
            <span className="text-slate-400">{t.source === "imessage" ? "💬 iMessage" : t.source === "autorun" ? "⚙️ auto" : "🌐 web"}</span>
            <span className="text-slate-500">{t.senderMasked}</span>
            <span className="ml-auto text-slate-400">
              {usd(t.costUsd)} · {(t.latencyMs / 1000).toFixed(1)}s · {t.status}
            </span>
          </div>
          <div className="mt-0.5 text-slate-100">“{t.text}”</div>
          {t.reasons.filter(Boolean).length > 0 && <div className="text-[10px] text-purple-300">↑ {t.reasons.filter(Boolean).join(" · ")}</div>}
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
