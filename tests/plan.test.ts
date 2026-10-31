import { describe, expect, it } from "vitest";
import { fromTemplate, normalize, parseFree, toTemplate, validatePlan, type Plan } from "../convex/lib/plan";
import { FALLBACK_PROFILE } from "../convex/lib/profile";

const robots = [
  { num: 1, battery: 92, status: "idle" },
  { num: 2, battery: 78, status: "idle" },
];

const transport = (from: string, to: string, kg = 40): Plan => ({
  jobs: [
    {
      robot: null,
      steps: [
        { action: "move_to", target: from, seconds: null },
        { action: "pick", target: null, seconds: null },
        { action: "move_to", target: to, seconds: null },
        { action: "drop", target: null, seconds: null },
      ],
    },
  ],
  payload_kg: kg,
  summary: `Pallet delivered to ${to}`,
  confidence: 0.9,
  blocked: false,
  blocked_reason: null,
});

describe("FREE tier parser", () => {
  it("answers status / where / help / dashboard without a model", () => {
    expect(parseFree("Status")).toEqual({ kind: "status" });
    expect(parseFree("where is robot 2?")).toEqual({ kind: "where", robot: 2 });
    expect(parseFree("help")).toEqual({ kind: "help" });
    expect(parseFree("dashboard")).toEqual({ kind: "dashboard" });
    expect(parseFree("move pallet from Dock A to Rack 3")).toBeNull();
  });
});

describe("normalize", () => {
  it("turns a transport command into a reusable signature", () => {
    const n = normalize("move pallet from Dock A to Rack 3");
    expect(n.signature).toBe("transport|LOC,LOC");
    expect(n.params).toMatchObject({ LOC1: "Dock A", LOC2: "Rack 3" });
    expect(n.risky).toBeNull();
  });

  it("flags human-zone requests as risky", () => {
    expect(normalize("send a robot into the human zone").risky).toBe("mentions the human zone");
  });
});

describe("skill templates", () => {
  it("round-trips a plan through a template with new locations", () => {
    const n = normalize("move pallet from Dock A to Rack 3");
    const tpl = toTemplate(transport("Dock A", "Rack 3"), n.params)!;
    const n2 = normalize("move pallet from Dock B to Rack 5");
    const plan = fromTemplate(tpl, n2.params)!;
    expect(plan.jobs[0].steps.map((s) => s.target)).toEqual(["Dock B", null, "Rack 5", null]);
    expect(plan.summary).toBe("Pallet delivered to Rack 5");
  });
});

describe("validatePlan (deterministic safety gate)", () => {
  it("accepts a normal transport", () => {
    expect(validatePlan(transport("Dock A", "Rack 3"), FALLBACK_PROFILE, robots)).toEqual({ ok: true });
  });

  it("blocks overweight loads", () => {
    const r = validatePlan(transport("Dock B", "Rack 2", 300), FALLBACK_PROFILE, robots);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toMatch(/exceeds max payload/);
  });

  it("blocks the human zone and unknown places", () => {
    expect(validatePlan(transport("Dock A", "Human Zone"), FALLBACK_PROFILE, robots)).toMatchObject({ ok: false });
    expect(validatePlan(transport("Dock A", "Rack 99"), FALLBACK_PROFILE, robots)).toMatchObject({ ok: false });
  });
});
