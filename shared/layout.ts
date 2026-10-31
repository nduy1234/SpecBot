// Warehouse grid shared by the server (planning) and the browser (rendering).
export const W = 20;
export const H = 12;
export const STEP_MS = 500; // time to cross one cell
export const DWELL_STEPS = { pick: 3, drop: 3, charge: 10 } as const;

export type Cell = { x: number; y: number };
export type LocKind = "dock" | "rack" | "charger" | "zone";

export const RACKS: { name: string; body: Cell[]; access: Cell }[] = [
  [6, 2, 4],
  [10, 2, 4],
  [14, 2, 4],
  [6, 8, 7],
  [10, 8, 7],
  [14, 8, 7],
].map(([x, y, ay], i) => ({
  name: `Rack ${i + 1}`,
  body: [
    { x, y },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x + 1, y: y + 1 },
  ],
  access: { x, y: ay },
}));

export const DOCKS: { name: string; access: Cell }[] = [
  { name: "Dock A", access: { x: 0, y: 2 } },
  { name: "Dock B", access: { x: 0, y: 6 } },
  { name: "Dock C", access: { x: 0, y: 10 } },
];

export const HUMAN_ZONE = { x0: 16, y0: 4, x1: 19, y1: 7 };
export const CHARGER_BAYS: Cell[] = [16, 17, 18, 19].map((x) => ({ x, y: 11 }));
export const HOMES: Cell[] = [
  { x: 2, y: 0 },
  { x: 4, y: 0 },
  { x: 2, y: 11 },
  { x: 4, y: 11 },
];

export const LOCATIONS: Record<string, { kind: LocKind; access: Cell }> = {
  ...Object.fromEntries(DOCKS.map((d) => [d.name, { kind: "dock" as const, access: d.access }])),
  ...Object.fromEntries(RACKS.map((r) => [r.name, { kind: "rack" as const, access: r.access }])),
  Charger: { kind: "charger", access: CHARGER_BAYS[0] },
  "Human Zone": { kind: "zone", access: { x: 17, y: 5 } },
};

export const LOCATION_NAMES = Object.keys(LOCATIONS);

export function inHumanZone(c: Cell) {
  return c.x >= HUMAN_ZONE.x0 && c.x <= HUMAN_ZONE.x1 && c.y >= HUMAN_ZONE.y0 && c.y <= HUMAN_ZONE.y1;
}

const blocked = new Set<string>(RACKS.flatMap((r) => r.body.map((c) => `${c.x},${c.y}`)));
export function isStatic(c: Cell) {
  return c.x < 0 || c.y < 0 || c.x >= W || c.y >= H || blocked.has(`${c.x},${c.y}`) || inHumanZone(c);
}

/** "dock a", "rack3", "charging station" -> canonical location name, or null. */
export function canonicalLocation(raw: string): string | null {
  const s = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  let m = s.match(/\bdock ?([abc])\b/);
  if (m) return `Dock ${m[1].toUpperCase()}`;
  m = s.match(/\brack ?#? ?([1-6])\b/);
  if (m) return `Rack ${m[1]}`;
  if (/\b(charg(er|ing)( station| bay| dock)?)\b/.test(s)) return "Charger";
  if (/\bhuman( zone| area)?\b|\bpeople\b|\bworkers?\b/.test(s)) return "Human Zone";
  return null;
}
