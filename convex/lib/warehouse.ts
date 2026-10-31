// Shared warehouse map + space-time A* planner. Pure TS: imported by Convex
// functions (server-authoritative planning) and by the React sim (rendering).

export const GRID_W = 22;
export const GRID_H = 14;

export type Cell = { x: number; y: number };
export type Loc = { name: string; access: Cell; kind: "dock" | "rack" | "charger" | "home" | "zone" };

export const RACKS: { name: string; x0: number; x1: number; y: number }[] = [
  { name: "Rack 1", x0: 6, x1: 8, y: 3 },
  { name: "Rack 2", x0: 10, x1: 12, y: 3 },
  { name: "Rack 3", x0: 14, x1: 16, y: 3 },
  { name: "Rack 4", x0: 6, x1: 8, y: 7 },
  { name: "Rack 5", x0: 10, x1: 12, y: 7 },
  { name: "Rack 6", x0: 14, x1: 16, y: 7 },
];

// Red human zone: robots must never enter these cells.
export const HUMAN_ZONE = { x0: 17, x1: 21, y0: 10, y1: 13 };

export const HOME_BAYS: Cell[] = [
  { x: 3, y: 13 },
  { x: 5, y: 13 },
  { x: 7, y: 13 },
  { x: 9, y: 13 },
];

export const LOCATIONS: Loc[] = [
  { name: "Dock A", access: { x: 1, y: 2 }, kind: "dock" },
  { name: "Dock B", access: { x: 1, y: 6 }, kind: "dock" },
  { name: "Dock C", access: { x: 1, y: 10 }, kind: "dock" },
  ...RACKS.map((r) => ({
    name: r.name,
    access: { x: (r.x0 + r.x1) / 2, y: r.y + 1 },
    kind: "rack" as const,
  })),
  { name: "Charger", access: { x: 20, y: 1 }, kind: "charger" },
  { name: "Human Zone", access: { x: 19, y: 11 }, kind: "zone" },
];

export const PRIMITIVES = ["move_to", "pick", "drop", "charge", "wait"] as const;
export type Primitive = (typeof PRIMITIVES)[number];

export function findLocation(name: string | null | undefined): Loc | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return LOCATIONS.find((l) => {
    const ln = l.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ln === n) return true;
    if (l.kind === "charger" && n.startsWith("charg")) return true;
    return false;
  });
}

export function inHumanZone(c: Cell) {
  return c.x >= HUMAN_ZONE.x0 && c.x <= HUMAN_ZONE.x1 && c.y >= HUMAN_ZONE.y0 && c.y <= HUMAN_ZONE.y1;
}

export function isBlocked(c: Cell) {
  if (c.x < 0 || c.y < 0 || c.x >= GRID_W || c.y >= GRID_H) return true;
  if (inHumanZone(c)) return true;
  if (c.x === 0) return true; // dock wall
  return RACKS.some((r) => c.y === r.y && c.x >= r.x0 && c.x <= r.x1);
}

// ---- Timed paths ---------------------------------------------------------
// A path is a list of [x, y, step] with absolute integer steps (step * stepMs = server ms).
export type PathPt = [number, number, number];
export type PathEvent = { step: number; type: "pick" | "drop" | "charge_start" | "charge_end" };

export type OtherRobot = { path: PathPt[] };

type Reservations = {
  at: Map<string, number>; // "x,y,step" -> robot index
  staticFrom: Map<string, number>; // "x,y" -> step from which a parked robot occupies it forever
  maxStep: Map<string, number>; // "x,y" -> last step any robot visits it
};

export function buildReservations(others: OtherRobot[]): Reservations {
  const at = new Map<string, number>();
  const staticFrom = new Map<string, number>();
  const maxStep = new Map<string, number>();
  others.forEach((o, i) => {
    o.path.forEach(([x, y, s], k) => {
      at.set(`${x},${y},${s}`, i);
      const ck = `${x},${y}`;
      maxStep.set(ck, Math.max(maxStep.get(ck) ?? -1, s));
      // fill gaps (dwell) between consecutive points
      const next = o.path[k + 1];
      if (next) for (let t = s + 1; t < next[2]; t++) at.set(`${x},${y},${t}`, i);
    });
    const last = o.path[o.path.length - 1];
    if (last) {
      const ck = `${last[0]},${last[1]}`;
      staticFrom.set(ck, Math.min(staticFrom.get(ck) ?? Infinity, last[2]));
    }
  });
  return { at, staticFrom, maxStep };
}

function occupied(r: Reservations, x: number, y: number, s: number) {
  if (r.at.has(`${x},${y},${s}`)) return true;
  const sf = r.staticFrom.get(`${x},${y}`);
  return sf !== undefined && s >= sf;
}

// Space-time A* from (start, s0) to goal. Moves: 4-neighbour or wait.
// finalPark=true means the robot will stay at goal forever, so no one may pass later.
export function planSegment(
  r: Reservations,
  start: Cell,
  s0: number,
  goal: Cell,
  finalPark: boolean,
): PathPt[] | null {
  const key = (x: number, y: number, s: number) => `${x},${y},${s}`;
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  type Node = { x: number; y: number; s: number; g: number; f: number; parent: Node | null };
  const open: Node[] = [{ x: start.x, y: start.y, s: s0, g: 0, f: h(start.x, start.y), parent: null }];
  const seen = new Set<string>([key(start.x, start.y, s0)]);
  const goalMax = r.maxStep.get(`${goal.x},${goal.y}`) ?? -1;
  let expansions = 0;
  while (open.length && expansions < 40000) {
    expansions++;
    // small grid: linear-scan priority queue is fine
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === goal.x && cur.y === goal.y && (!finalPark || cur.s > goalMax)) {
      const out: PathPt[] = [];
      for (let n: Node | null = cur; n; n = n.parent) out.push([n.x, n.y, n.s]);
      return out.reverse();
    }
    if (cur.g > 300) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const ns = cur.s + 1;
      if (isBlocked({ x: nx, y: ny })) continue;
      if (occupied(r, nx, ny, ns)) continue;
      // swap conflict: someone moving from (nx,ny) into (cur.x,cur.y)
      const a = r.at.get(key(nx, ny, cur.s));
      if (a !== undefined && a === r.at.get(key(cur.x, cur.y, ns))) continue;
      const k = key(nx, ny, ns);
      if (seen.has(k)) continue;
      seen.add(k);
      const g = cur.g + 1;
      open.push({ x: nx, y: ny, s: ns, g, f: g + h(nx, ny), parent: cur });
    }
  }
  return null;
}

export type PlanStep = { action: string; target?: string | null; seconds?: number | null };

export type ExecResult =
  | { ok: true; path: PathPt[]; events: PathEvent[]; cellsMoved: number; endStep: number; charged: boolean }
  | { ok: false; reason: string };

// Expand primitive steps into one timed path for a single robot, ending at its home bay.
export function executeJob(
  steps: PlanStep[],
  start: Cell,
  home: Cell,
  s0: number,
  others: OtherRobot[],
  stepMs: number,
): ExecResult {
  const r = buildReservations(others);
  const path: PathPt[] = [[start.x, start.y, s0]];
  const events: PathEvent[] = [];
  let charged = false;
  const cur = () => path[path.length - 1];
  const goTo = (c: Cell, park: boolean) => {
    const [x, y, s] = cur();
    if (x === c.x && y === c.y && !park) return true;
    const seg = planSegment(r, { x, y }, s, c, park);
    if (!seg) return false;
    path.push(...seg.slice(1));
    return true;
  };
  const dwell = (n: number) => {
    const [x, y, s] = cur();
    path.push([x, y, s + n]);
  };
  for (const st of steps) {
    if (st.action === "move_to") {
      const loc = findLocation(st.target);
      if (!loc) return { ok: false, reason: `unknown location "${st.target}"` };
      if (!goTo(loc.access, false)) return { ok: false, reason: `no collision-free path to ${loc.name}` };
    } else if (st.action === "pick" || st.action === "drop") {
      events.push({ step: cur()[2], type: st.action });
      dwell(3);
    } else if (st.action === "charge") {
      const ch = findLocation("Charger")!;
      if (!goTo(ch.access, false)) return { ok: false, reason: "charger unreachable" };
      events.push({ step: cur()[2], type: "charge_start" });
      dwell(8);
      events.push({ step: cur()[2], type: "charge_end" });
      charged = true;
    } else if (st.action === "wait") {
      dwell(Math.max(1, Math.ceil(((st.seconds ?? 2) * 1000) / stepMs)));
    }
  }
  if (!goTo(home, true)) return { ok: false, reason: "could not find a free path back to home bay" };
  let cellsMoved = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i][0] !== path[i - 1][0] || path[i][1] !== path[i - 1][1]) cellsMoved++;
  }
  return { ok: true, path, events, cellsMoved, endStep: cur()[2], charged };
}

// Interpolated position of a timed path at an absolute (fractional) step.
export function positionAt(path: PathPt[], step: number): { x: number; y: number } {
  if (!path.length) return { x: 0, y: 0 };
  if (step <= path[0][2]) return { x: path[0][0], y: path[0][1] };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (step <= b[2]) {
      const t = b[2] === a[2] ? 1 : (step - a[2]) / (b[2] - a[2]);
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    }
  }
  const l = path[path.length - 1];
  return { x: l[0], y: l[1] };
}

export const BATTERY_PER_CELL = 0.35;
