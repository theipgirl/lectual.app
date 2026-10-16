import { describe, it, expect } from "vitest";
import { periodDelta, unavailableMetric } from "@/lib/reports/metric";

describe("periodDelta", () => {
  it("is null when either side is unknown", () => {
    expect(periodDelta(null, 5)).toBeNull();
    expect(periodDelta(5, null)).toBeNull();
    expect(periodDelta(null, null)).toBeNull();
  });

  it("is a signed percentage when the previous period was non-zero", () => {
    expect(periodDelta(11, 10)).toBe("+10%");
    expect(periodDelta(9, 10)).toBe("−10%");
  });

  it("rounds to the nearest percent", () => {
    expect(periodDelta(13, 12)).toBe("+8%"); // 8.33%
  });

  it("is null when nothing changed", () => {
    expect(periodDelta(10, 10)).toBeNull();
    expect(periodDelta(0, 0)).toBeNull();
  });

  it("falls back to a raw signed count when the previous period was zero", () => {
    expect(periodDelta(3, 0)).toBe("+3");
    expect(periodDelta(0, 0)).toBeNull();
  });

  it("handles a drop to zero as a percentage", () => {
    expect(periodDelta(0, 4)).toBe("−100%");
  });
});

describe("unavailableMetric", () => {
  it("carries a null value and the reason as `note`, never a fabricated sub-line", () => {
    const m = unavailableMetric("Drafts out", "Agents aren't on for this firm");
    expect(m.value).toBeNull();
    expect(m.note).toBe("Agents aren't on for this firm");
    expect(m.sub).toBe("");
  });
});
