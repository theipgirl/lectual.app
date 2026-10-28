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
