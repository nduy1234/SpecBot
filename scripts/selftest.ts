import { planRobot, occFromWaypoints } from "../shared/astar";
import { HOMES } from "../shared/layout";
import { normalize, parameterize, fillTemplate, riskSignals } from "../shared/normalize";
import { validatePlan } from "../shared/validator";
import { FALLBACK_PROFILE } from "../shared/fallbackProfile";

const steps = [{ action: "move_to", target: "Dock A" }, { action: "pick", item: "pallet", weight_kg: 20 }, { action: "move_to", target: "Rack 3" }, { action: "drop" }];
const s0 = 1000;
const a = planRobot(1, HOMES[0], s0, steps, []);
if ("error" in a) throw new Error(a.error);
const b = planRobot(2, HOMES[1], s0, [{ action: "move_to", target: "Dock B" }, { action: "pick" }, { action: "move_to", target: "Rack 1" }, { action: "drop" }], [occFromWaypoints(a.waypoints, HOMES[0])]);
if ("error" in b) throw new Error(b.error);
// collision check
const oa = occFromWaypoints(a.waypoints, HOMES[0]), ob = occFromWaypoints(b.waypoints, HOMES[1]);
for (let s = s0; s < s0 + 300; s++) { const p = oa(s), q = ob(s); if (p.x === q.x && p.y === q.y) throw new Error("collision at " + s); }
console.log("A* ok: r1", a.waypoints.length, "steps, task", (a.taskEndT - s0 * 500) / 1000, "s; r2", b.waypoints.length);
for (const t of ["move pallet from Dock A to Rack 3", "Move boxes from rack 4 to dock c", "bring 300 kg of steel from Dock A to Rack 5", "charge robot 2", "send robot 3 to Dock A", "use two robots to move 150 kg of parts from Dock C to Rack 6", "drive robot 1 through the human zone to Dock C"]) console.log(JSON.stringify(normalize(t)), riskSignals(t));
const i1 = normalize("move pallet from Dock A to Rack 3")!;
const tpl = parameterize({ assignments: [{ robot: null, steps }], confidence: 0.9, summary: "", risky: false, blocked_reason: null } as any, i1)!;
const filled = fillTemplate(tpl, normalize("move boxes from Rack 4 to Dock C")!);
console.log(JSON.stringify(filled.assignments[0].steps));
console.log(validatePlan(filled, FALLBACK_PROFILE, [1, 2, 3, 4].map((num) => ({ num, battery: 90 }))));
const heavy = fillTemplate(tpl, normalize("move 300 kg steel from Dock A to Rack 5")!);
console.log(JSON.stringify(heavy.assignments[0].steps[1]), validatePlan(heavy, FALLBACK_PROFILE, [{ num: 1, battery: 90 }]));
// multi-robot split plans must never become skills
const split = { assignments: [1, 2, 3].map(() => ({ robot: null, steps: [{ action: "move_to", target: "Dock A" }, { action: "pick", item: "steel", weight_kg: 100 }, { action: "move_to", target: "Rack 5" }, { action: "drop" }] })), confidence: 0.9, summary: "", risky: true, blocked_reason: null } as any;
console.log("split cached?", parameterize(split, normalize("bring 300 kg of steel from Dock A to Rack 5")!) !== null);
const kgT = parameterize({ assignments: [{ robot: null, steps: [{ action: "move_to", target: "Dock A" }, { action: "pick", item: "boxes", weight_kg: 40 }, { action: "move_to", target: "Rack 2" }, { action: "drop" }] }], confidence: 0.9, summary: "", risky: false, blocked_reason: null } as any, normalize("move 40 kg boxes from Dock A to Rack 2")!)!;
const big = fillTemplate(kgT, normalize("move a 500 kg engine from Dock A to Rack 2")!);
console.log("500kg via kg-skill:", JSON.stringify(validatePlan(big, FALLBACK_PROFILE, [{ num: 1, battery: 90 }])));
