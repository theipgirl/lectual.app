import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionTabs } from "@/components/shell/SectionTabs";

describe("SectionTabs (F2)", () => {
  const html = (active: "list" | "summary") =>
    renderToStaticMarkup(createElement(SectionTabs, { active, listLabel: "Leads", listHref: "/dashboard/intake/", summaryHref: "/dashboard/reports/intake/" }));

  it("links the list and the Summary, marking the current one", () => {
    const list = html("list");
    expect(list).toMatch(/aria-current="page" class="on" href="\/dashboard\/intake\/?">Leads</);
    expect(list).toMatch(/href="\/dashboard\/reports\/intake\/?">Summary</);
    expect(html("summary")).toMatch(/aria-current="page" class="on" href="\/dashboard\/reports\/intake\/?">Summary</);
  });

  it("is used on the Leads and Matters lists and on the report pages", () => {
    expect(readFileSync("src/app/dashboard/intake/_components/IntakeWorkspace.tsx", "utf8")).toContain('<SectionTabs active="list"');
    expect(readFileSync("src/app/dashboard/matters/page.tsx", "utf8")).toContain('<SectionTabs active="list"');
    expect(readFileSync("src/app/dashboard/reports/[key]/page.tsx", "utf8")).toContain('<SectionTabs active="summary"');
  });

  it("does not reuse the Table | Board toggle's class, so each page still has one toggle", () => {
    expect(readFileSync("src/components/shell/SectionTabs.tsx", "utf8")).not.toContain("lx-view-toggle");
  });
});

describe("every report is reachable (Sprint 32 fix)", () => {
  it("links each REPORTS href from at least one non-report dashboard page or list component", async () => {
    const { REPORTS } = await import("@/lib/nav");
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        if (p.includes(join("dashboard", "reports"))) return [];
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
      });
    const pages = [...walk("src/app/dashboard"), ...walk("src/components/list-page"), ...walk("src/app/dashboard/intake/_components")].map((p) => readFileSync(p, "utf8"));
    for (const [key, r] of Object.entries(REPORTS)) {
      const linked = pages.some((src) => src.includes(`REPORTS.${key}.href`) || src.includes(r.href));
      expect(linked, `${key} report is not linked from any list page`).toBe(true);
    }
  });

  it("Mail, Meetings and Copilot draw the List | Summary strip", () => {
    expect(readFileSync("src/app/dashboard/mail/page.tsx", "utf8")).toContain("REPORTS.communication.href");
    expect(readFileSync("src/app/dashboard/meetings/page.tsx", "utf8")).toContain("REPORTS.communication.href");
    expect(readFileSync("src/app/dashboard/copilot/page.tsx", "utf8")).toContain("REPORTS.ipos.href");
  });
});
