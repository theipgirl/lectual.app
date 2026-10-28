import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { walk } from "../ui/_scan";

describe("the List | Summary strip is gone (Sprint 34 C)", () => {
  it("nothing in src names SectionTabs or the list-tab helpers", () => {
    const hits = walk("src").filter((f) => /SectionTabs|reportListHref|reportListLabel|SUMMARY_TAB/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    expect(existsSync("src/components/shell/SectionTabs.tsx")).toBe(false);
    expect(existsSync("tests/shell/section-tabs.test.ts")).toBe(false);
    expect(readFileSync("src/app/globals.css", "utf8")).not.toContain("lx-section-tabs");
  });

  it("the Reports index page exists with its own title and gates on what the firm can see", () => {
    const page = readFileSync("src/app/dashboard/reports/page.tsx", "utf8");
    expect(page).toContain('pageTitle("Reports")');
    expect(page).toContain("visibleReports(");
    expect(readFileSync("src/app/dashboard/reports/[key]/page.tsx", "utf8")).toContain("REPORTS_INDEX");
  });
});
