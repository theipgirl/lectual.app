import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pageTitle, recordPageTitle } from "@/lib/ui/page-title";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return name === "page.tsx" ? [p] : [];
  });
}

describe("pageTitle", () => {
  it("builds '<Page> · Lectual'", () => {
    expect(pageTitle("Calendar")).toBe("Calendar · Lectual");
  });
  it("falls back to Lectual on empty input", () => {
    expect(pageTitle()).toBe("Lectual");
    expect(pageTitle("   ")).toBe("Lectual");
    expect(pageTitle(null)).toBe("Lectual");
  });
  it("collapses whitespace and clips a long name", () => {
    expect(pageTitle("A   B")).toBe("A B · Lectual");
    expect(pageTitle("x".repeat(200)).length).toBeLessThan(100);
  });
});

describe("recordPageTitle", () => {
  it("uses the record's name", async () => {
    expect(await recordPageTitle(async () => "Ada Lovelace", "Lead")).toBe("Ada Lovelace · Lectual");
  });
  it("falls back when the record is missing or the name is blank", async () => {
    expect(await recordPageTitle(async () => null, "Lead")).toBe("Lead · Lectual");
    expect(await recordPageTitle(async () => "", "Matter")).toBe("Matter · Lectual");
  });
  it("falls back when the read throws, without leaking the error", async () => {
    const t = await recordPageTitle(async () => {
      throw new Error("secret detail");
    }, "Matter");
    expect(t).toBe("Matter · Lectual");
  });
});

describe("every dashboard page sets a title", () => {
  const files = pages("src/app/dashboard");
  it("finds the pages", () => expect(files.length).toBeGreaterThan(40));
  it.each(files)("%s exports metadata or generateMetadata", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/export (const metadata\b|async function generateMetadata\b)/);
  });
  it("the reports page titles each tab from REPORTS[key].label, not a fixed 'Report'", () => {
    const src = readFileSync("src/app/dashboard/reports/[key]/page.tsx", "utf8");
    expect(src).toMatch(/pageTitle\(isReportKey\(key\) \? REPORTS\[key\]\.label/);
    expect(src).not.toMatch(/metadata: Metadata = \{ title: pageTitle\("Report"\)/);
  });
  it("lead and matter titles never use the service role", () => {
    for (const f of ["src/app/dashboard/leads/[id]/page.tsx", "src/app/dashboard/matters/[id]/page.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/db\/admin|getAdminClient/);
    }
  });
});
