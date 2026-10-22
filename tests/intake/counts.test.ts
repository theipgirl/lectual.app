import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INTAKE_PRACTICE_AREA_FILTER, PIPELINE_INTAKE_HINT, RAIL_COUNT_TITLE } from "@/lib/intake/counts";
import { isTrademarkIntake } from "@/lib/intake/scope";
import { COLUMN_HINT } from "@/lib/lifecycle/columns";

describe("intake count definitions", () => {
  it("the rail count and the Intake list use the one shared practice-area filter", () => {
    for (const f of ["src/lib/nav-counts.ts", "src/lib/intake/leads.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("INTAKE_PRACTICE_AREA_FILTER");
      expect(src).not.toContain('"practice_area.is.null');
    }
  });
  it("the shared filter says what isTrademarkIntake says", () => {
    expect(INTAKE_PRACTICE_AREA_FILTER).toContain("practice_area.is.null");
    expect(INTAKE_PRACTICE_AREA_FILTER).toContain("ilike.%trademark%");
    expect(isTrademarkIntake({ practice_area: null })).toBe(true);
    expect(isTrademarkIntake({ practice_area: "Trademark" })).toBe(true);
    expect(isTrademarkIntake({ practice_area: "Copyright" })).toBe(false);
  });
  it("the rail badge and the Pipeline column each say what they count", () => {
    expect(RAIL_COUNT_TITLE.intake).toMatch(/trademark/i);
    expect(COLUMN_HINT.intake).toBe(PIPELINE_INTAKE_HINT);
    expect(PIPELINE_INTAKE_HINT).toMatch(/rail/i);
  });
  it("the rail draws the tooltip", () => {
    expect(readFileSync("src/components/shell/Rail.tsx", "utf8")).toContain("RAIL_COUNT_TITLE");
  });
});
