import { describe, expect, it } from "vitest";
import { placePop } from "@/lib/review/pop-place";

const view = { width: 1440, height: 900 };
const pop = { width: 270, height: 230 };

describe("placePop", () => {
  it("opens below the cell when there is room", () => {
    const p = placePop({ top: 300, bottom: 340, left: 1000, right: 1100 }, pop, view, "left");
    expect(p).toEqual({ top: 338, left: 1004, above: false });
  });
  it("opens upward when the bottom rows leave no room below", () => {
    const p = placePop({ top: 780, bottom: 820, left: 1000, right: 1100 }, pop, view, "left");
    expect(p.above).toBe(true);
    expect(p.top + pop.height).toBeLessThanOrEqual(780 + 2);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
  it("right-aligns to the cell and stays inside the window", () => {
    expect(placePop({ top: 100, bottom: 140, left: 1330, right: 1409 }, pop, view, "right").left).toBe(1139);
    expect(placePop({ top: 100, bottom: 140, left: 1400, right: 1500 }, pop, view, "left").left).toBe(1440 - 8 - 270);
  });
  it("pins to the window edge when neither side fits", () => {
    const p = placePop({ top: 100, bottom: 140, left: 10, right: 90 }, { width: 270, height: 880 }, view, "left");
    expect(p.above).toBe(false);
    expect(p.top).toBe(12);
  });
});
