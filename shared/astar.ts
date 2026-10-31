// Space-time A* with cell reservation (prioritized planning): each new path avoids
// every cell other robots occupy at each time step, plus head-on swaps.
import { DWELL_STEPS, HOMES, CHARGER_BAYS, LOCATIONS, STEP_MS, isStatic, type Cell } from "./layout";
import type { Step, Waypoint } from "./types";

export type Occ = (step: number) => Cell;

export function occFromWaypoints(wps: Waypoint[], fallback: Cell): Occ {
  if (!wps.length) return () => fallback;
  const first = Math.round(wps[0].t / STEP_MS);
  return (s) => {
    const i = Math.min(Math.max(s - first, 0), wps.length - 1);
    return wps[i];
  };
}

const eq = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const MOVES = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function taken(c: Cell, s: number, others: Occ[]) {
  for (const o of others) if (eq(o(s), c)) return true;
  return false;
}

/** Returns cells for steps startStep..arrival (inclusive), or null. */
export function planLeg(start: Cell, startStep: number, goal: Cell, others: Occ[], dwell: number, horizon = 260): Cell[] | null {
  type Node = { x: number; y: number; s: number; g: number; f: number; parent: Node | null };
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const open: Node[] = [{ x: start.x, y: start.y, s: startStep, g: 0, f: h(start.x, start.y), parent: null }];
  const seen = new Set<string>();
  const push = (n: Node) => {
    open.push(n);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (open[p].f <= open[i].f) break;
      [open[p], open[i]] = [open[i], open[p]];
      i = p;
    }
  };
  const pop = (): Node => {
    const top = open[0];
    const last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < open.length && open[l].f < open[m].f) m = l;
        if (r < open.length && open[r].f < open[m].f) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i], open[m]];
        i = m;
      }
    }
    return top;
  };

  while (open.length) {
    const n = pop();
    const key = `${n.x},${n.y},${n.s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (n.x === goal.x && n.y === goal.y) {
      let free = true;
      for (let k = 1; k <= dwell && free; k++) if (taken(goal, n.s + k, others)) free = false;
      if (free) {
        const out: Cell[] = [];
        for (let c: Node | null = n; c; c = c.parent) out.push({ x: c.x, y: c.y });
        return out.reverse();
      }
    }
    if (n.g >= horizon) continue;
    for (const [dx, dy] of MOVES) {
      const nx = n.x + dx,
        ny = n.y + dy,
        ns = n.s + 1;
      const c = { x: nx, y: ny };
      if (isStatic(c) && !eq(c, goal) && !eq(c, start)) continue;
      if (seen.has(`${nx},${ny},${ns}`)) continue;
      if (taken(c, ns, others)) continue;
      // head-on swap
      if (others.some((o) => eq(o(n.s), c) && eq(o(ns), n))) continue;
      push({ x: nx, y: ny, s: ns, g: n.g + 1, f: n.g + 1 + h(nx, ny), parent: n });
    }
  }
  return null;
}

export type RobotPlan = { waypoints: Waypoint[]; taskEndT: number; endT: number };

/** Turns primitive steps into timed waypoints for one robot, ending back at home. */
export function planRobot(robotNum: number, start: Cell, startStep: number, steps: Step[], others: Occ[]): RobotPlan | { error: string } {
  const cells: { c: Cell; a: string; carry: boolean }[] = [{ c: start, a: "start", carry: false }];
  let cur = start;
  let s = startStep;
  let carry = false;
  const bay = CHARGER_BAYS[robotNum - 1] ?? CHARGER_BAYS[0];
  const home = HOMES[robotNum - 1] ?? HOMES[0];
  const dwellAt = (n: number, a: string) => {
    for (let k = 0; k < n; k++) cells.push({ c: cur, a, carry });
    s += n;
  };
  const go = (goal: Cell, dwell: number, a: string) => {
    const leg = planLeg(cur, s, goal, others, dwell);
    if (!leg) return false;
    for (const c of leg.slice(1)) cells.push({ c, a, carry });
    s += leg.length - 1;
    cur = goal;
    return true;
  };

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const next = steps[i + 1]?.action;
    const dwellNext = next === "pick" ? DWELL_STEPS.pick : next === "drop" ? DWELL_STEPS.drop : next === "charge" ? DWELL_STEPS.charge : 2;
    if (st.action === "move_to") {
      const loc = LOCATIONS[st.target ?? ""];
      if (!loc) return { error: `unknown location ${st.target}` };
      const goal = loc.kind === "charger" ? bay : loc.access;
      if (!go(goal, dwellNext, "move")) return { error: `no collision-free path to ${st.target}` };
    } else if (st.action === "pick") {
      dwellAt(DWELL_STEPS.pick, "pick");
      carry = true;
      cells[cells.length - 1].carry = true;
    } else if (st.action === "drop") {
      dwellAt(DWELL_STEPS.drop, "drop");
      carry = false;
      cells[cells.length - 1].carry = false;
    } else if (st.action === "charge") {
      if (!eq(cur, bay) && !go(bay, DWELL_STEPS.charge, "move")) return { error: "charger unreachable" };
      dwellAt(DWELL_STEPS.charge, "charge");
    } else if (st.action === "wait") {
      dwellAt(Math.max(1, Math.round(((st.seconds ?? 2) * 1000) / STEP_MS)), "wait");
    }
  }
  const taskEndStep = s;
  if (!eq(cur, home)) go(home, 400, "home");
  const waypoints = cells.map((k, i) => ({ x: k.c.x, y: k.c.y, t: (startStep + i) * STEP_MS, a: k.a, c: k.carry }));
  return { waypoints, taskEndT: taskEndStep * STEP_MS, endT: (startStep + cells.length - 1) * STEP_MS };
}
