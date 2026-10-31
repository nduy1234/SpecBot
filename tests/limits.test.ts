import { describe, expect, it } from "vitest";
import { checkAdminKey, envNumber, hitWindow, overBudget, type Window } from "../convex/lib/limits";

describe("hitWindow", () => {
  it("allows up to max hits per window, then blocks until the window rolls over", () => {
    let w: Window | null = null;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = hitWindow(w, 1000 + i, 60_000, 3);
      results.push(r.allowed);
      w = r.next;
    }
    expect(results).toEqual([true, true, true, false]);
    const later = hitWindow(w, 1000 + 60_000, 60_000, 3);
    expect(later).toEqual({ allowed: true, next: { windowStart: 61_000, count: 1 } });
  });

  it("max 0 blocks everything", () => {
    expect(hitWindow(null, 0, 60_000, 0).allowed).toBe(false);
  });
});

describe("envNumber", () => {
  it("falls back on missing, empty, negative or garbage values", () => {
    expect(envNumber(undefined, 5)).toBe(5);
    expect(envNumber("", 5)).toBe(5);
    expect(envNumber("-1", 5)).toBe(5);
    expect(envNumber("abc", 5)).toBe(5);
    expect(envNumber("2.5", 5)).toBe(2.5);
    expect(envNumber("0", 5)).toBe(0);
  });
});

describe("overBudget / checkAdminKey", () => {
  it("trips at the budget", () => {
    expect(overBudget(4.99, 5)).toBe(false);
    expect(overBudget(5, 5)).toBe(true);
  });

  it("never accepts an admin key when none is configured", () => {
    expect(checkAdminKey(undefined, "")).toBe(false);
    expect(checkAdminKey("", "")).toBe(false);
    expect(checkAdminKey("k", null)).toBe(false);
    expect(checkAdminKey("k", "x")).toBe(false);
    expect(checkAdminKey("k", "k")).toBe(true);
  });
});
