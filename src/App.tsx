import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../convex/_generated/api";
import { Warehouse } from "./sim/Warehouse";
import { Banner, Chat, CostChart, Counters, Feed, JoinPage, Skills } from "./dashboard/Dashboard";

export default function App() {
  if (new URLSearchParams(location.search).has("join")) return <JoinPage />;
  return <Main />;
}

function Main() {
  const robots = useQuery(api.sim.robots);
  const profile = useQuery(api.tasks.profile);
  const seed = useMutation(api.sim.seed);
  const serverTime = useAction(api.sim.serverTime);
  const offset = useRef(0);

  useEffect(() => {
    seed({}).catch(() => {});
    const sync = async () => {
      const t0 = Date.now();
      const s = await serverTime({});
      offset.current = s - (t0 + Date.now()) / 2;
    };
    sync();
    const id = setInterval(sync, 30_000);
    return () => clearInterval(id);
  }, [seed, serverTime]);

  return (
    <div className="flex h-screen flex-col gap-2 bg-slate-950 p-2 text-white lg:flex-row">
      <div className="relative min-h-[45vh] flex-[5] overflow-hidden rounded-xl border border-slate-800">
        <Warehouse robots={robots ?? []} offset={() => offset.current} />
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] text-slate-300">
          <span className="text-emerald-400">■</span> idle <span className="text-blue-400">■</span> busy <span className="text-yellow-400">■</span> charging{" "}
          <span className="text-red-400">■</span> human zone
          {profile && (
            <div className="text-slate-400">
              Profile: {profile.data.name} · {profile.data.max_payload_kg} kg max · {profile.source}
            </div>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-[4] flex-col gap-2 overflow-y-auto">
        <Banner />
        <Counters />
        <CostChart />
        <div className="grid flex-1 grid-cols-1 gap-2">
          <section className="flex h-[520px] shrink-0 flex-col rounded-lg border border-slate-800 p-2">
            <h2 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Live feed · which brain, and what it saved
              <span className="ml-auto flex gap-1 normal-case tracking-normal">
                <span className="rounded bg-emerald-500 px-1 text-white">✓ used</span>
                <span className="rounded bg-amber-600/80 px-1 text-white">escalated</span>
                <span className="rounded border border-dashed border-slate-600 px-1">skipped</span>
                <span className="rounded bg-purple-900/60 px-1 text-purple-200">bar = Opus cost</span>
              </span>
            </h2>
            <div className="min-h-0 flex-1">
              <Feed />
            </div>
          </section>
          <section className="flex min-h-0 flex-col rounded-lg border border-slate-800 p-2">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Web chat (fallback)</h2>
            <div className="min-h-[200px] flex-1">
              <Chat />
            </div>
          </section>
        </div>
        <section className="shrink-0 rounded-lg border border-slate-800 p-2">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Skill library</h2>
          <Skills />
        </section>
      </div>
    </div>
  );
}
