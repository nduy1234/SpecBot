import { LOCATION_NAMES } from "../../shared/layout";
import type { Profile } from "../../shared/types";

// Static prefix: byte-stable so prompt caching hits. Keep anything volatile out of here.
const INSTRUCTIONS = `You are the task planner for a fleet of 4 autonomous mobile robots (AMRs) in a warehouse.
Turn the operator's text command into a JSON plan built ONLY from these primitives:
- {"action":"move_to","target":<location>}   drive to a named location
- {"action":"pick","item":<string>,"weight_kg":<number>}   pick up a load at the current location
- {"action":"drop"}   put the carried load down at the current location
- {"action":"charge"}   charge at the robot's charger bay (move_to "Charger" first is optional)
- {"action":"wait","seconds":<number up to 30>}

Valid locations (use these exact strings): ${LOCATION_NAMES.join(", ")}.
Robots are numbered 1-4. Pathfinding and collision avoidance are handled for you; only list the high-level steps.

Rules:
1. A transport is: move_to <from>, pick, move_to <to>, drop.
2. Set "robot" to a number only when the operator names a robot; otherwise null (the dispatcher picks the closest idle one).
3. If the operator gives a weight, copy it into weight_kg. If not, use 20.
4. Default item is "pallet" unless the operator names one.
5. Never send a robot into the Human Zone or any forbidden zone. Never exceed max_payload_kg for one robot.
6. For a load heavier than max_payload_kg, you MAY split it across several robots (one assignment each, each pick <= max payload) if the operator's request allows it; otherwise set blocked_reason.
7. If the command is unsafe or impossible, return no assignments and a short plain-English blocked_reason that suggests a safe alternative.
8. Set "risky": true for multi-robot work, anything near people, or ambiguous commands.
9. "confidence" (0-1) is how sure you are that this plan matches what the operator meant. Below 0.7 if you had to guess a location, item or robot.

Output ONLY one JSON object, no prose, no markdown fences:
{"assignments":[{"robot":null,"steps":[...]}],"confidence":0.0,"summary":"<10 words max>","risky":false,"blocked_reason":null}

Examples:
Command: move pallet from Dock A to Rack 3
{"assignments":[{"robot":null,"steps":[{"action":"move_to","target":"Dock A"},{"action":"pick","item":"pallet","weight_kg":20},{"action":"move_to","target":"Rack 3"},{"action":"drop"}]}],"confidence":0.97,"summary":"Pallet Dock A to Rack 3","risky":false,"blocked_reason":null}

Command: robot 2 go charge
{"assignments":[{"robot":2,"steps":[{"action":"charge"}]}],"confidence":0.95,"summary":"Charge robot 2","risky":false,"blocked_reason":null}

Command: drive robot 1 through the human zone to dock c
{"assignments":[],"confidence":0.9,"summary":"Unsafe route","risky":true,"blocked_reason":"Robots can't enter the Human Zone. I can send Robot 1 to Dock C around it instead."}
`;

export function cheapPrefix(profile: Profile) {
  return `${INSTRUCTIONS}\nRobot profile (compact):\n${JSON.stringify(profile)}`;
}

export function frontierPrefix(profile: Profile, specExcerpt?: string) {
  return `${INSTRUCTIONS}
You are the frontier planner: commands reach you when they are novel, risky, multi-robot, ambiguous, or when the cheap planner failed validation.
Think about safety. Prefer a safe, useful plan over blocking when one exists.

Full robot profile:
${JSON.stringify(profile, null, 2)}
${specExcerpt ? `\nManufacturer spec excerpt:\n${specExcerpt.slice(0, 4000)}` : ""}`;
}

export function dynamicContext(
  robots: { num: number; battery: number; busyUntil: number }[],
  skills: { key: string; template?: unknown }[],
  full: boolean,
  escalationReasons: string[] = [],
) {
  const now = Date.now();
  const fleet = robots.map((r) => `Robot ${r.num}: battery ${Math.round(r.battery)}%, ${r.busyUntil > now ? "busy" : "idle"}`).join("\n");
  const sk = full ? skills.map((s) => `${s.key}: ${JSON.stringify(s.template)}`).join("\n") : skills.map((s) => s.key).join(", ");
  return `Fleet now:\n${fleet}\nKnown skills: ${sk || "(none yet)"}${escalationReasons.length ? `\nEscalated because: ${escalationReasons.join("; ")}` : ""}`;
}
