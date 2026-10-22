import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { comparisonFields, comparisonText, periodDelta } from "@/lib/reports/metric";
import { KpiTile } from "@/components/reports/KpiTile";
import { DashboardError } from "@/components/shell/DashboardError";
import { readFileSync } from "node:fs";

describe("period comparison", () => {
  it("2 vs 168 shows the prior count and no percentage", () => {
    expect(periodDelta(2, 168)).toBeNull();
    expect(comparisonText(2, 168, 7)).toBe("2 vs 168 in the previous 7 days");
  });
  it("prior 0 shows a plain difference, never a percentage", () => {
    expect(periodDelta(5, 0)).toBe("+5");
    expect(comparisonFields(5, 0, 30).compare).toBe("5 vs 0 in the previous 30 days");
  });
  it("equal values show no delta", () => {
    expect(periodDelta(10, 10)).toBeNull();
  });
  it("normal increase and decrease keep their percentage", () => {
    expect(periodDelta(12, 10)).toBe("+20%");
    expect(periodDelta(80, 100)).toBe("−20%");
  });
  it("a change beyond 500% shows no percentage", () => {
    expect(periodDelta(70, 10)).toBeNull();
    expect(periodDelta(60, 10)).toBe("+500%");
  });
  it("unknown sides give nothing", () => {
    expect(comparisonText(null, 4, 7)).toBeNull();
  });
});

describe("KpiTile", () => {
  it("renders the prior count under a withheld percentage", () => {
    const html = renderToStaticMarkup(KpiTile({ m: { label: "New leads", value: 2, sub: "into the pipeline", ...comparisonFields(2, 168, 7) } }));
    expect(html).toContain("2 vs 168 in the previous 7 days");
    expect(html).not.toContain("%");
  });
  it("an unreadable metric stays a dash with its reason", () => {
    const html = renderToStaticMarkup(KpiTile({ m: { label: "New leads", value: null, sub: "", note: "Leads couldn't be loaded" } }));
    expect(html).toContain("—");
    expect(html).toContain("Leads couldn&#x27;t be loaded");
  });
});

describe("failed page reads", () => {
  it("the dashboard error boundary says the page could not be loaded", () => {
    const html = renderToStaticMarkup(DashboardError({ reset: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("couldn&#x27;t be loaded");
    expect(html).toContain("Try again");
  });
  it("report range switches do not prefetch", () => {
    expect(readFileSync("src/app/dashboard/reports/[key]/page.tsx", "utf8")).toContain("prefetch={false}");
  });
});
