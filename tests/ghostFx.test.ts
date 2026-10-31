import { describe, expect, it } from "vitest";
import { BOO_MS, booStyle, sheetOpacity, trailAlpha } from "../src/ghostFx";

describe("sheetOpacity", () => {
  it("is solid at healthy battery and only slightly transparent when low", () => {
    expect(sheetOpacity(92)).toBe(1);
    expect(sheetOpacity(30)).toBe(1);
    expect(sheetOpacity(20)).toBeCloseTo(0.8);
    expect(sheetOpacity(10)).toBeCloseTo(0.6);
    expect(sheetOpacity(0)).toBeCloseTo(0.6);
  });
});

describe("booStyle", () => {
  it("is hidden before start and after BOO_MS, visible in between", () => {
    expect(booStyle(-1).alpha).toBe(0);
    expect(booStyle(BOO_MS).alpha).toBe(0);
    expect(booStyle(600).alpha).toBe(1);
    expect(booStyle(75).alpha).toBeCloseTo(0.5);
    expect(booStyle(BOO_MS - 200).alpha).toBeCloseTo(0.5);
  });
});

describe("trailAlpha", () => {
  it("fades with distance and disappears when parked", () => {
    expect(trailAlpha(0, 4, 1)).toBeCloseTo(0.3);
    expect(trailAlpha(3, 4, 1)).toBeLessThan(trailAlpha(0, 4, 1));
    expect(trailAlpha(0, 4, 0)).toBe(0);
  });
});
