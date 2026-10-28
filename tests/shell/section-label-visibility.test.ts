import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sectionLabelFor, showSectionLabel } from "@/lib/section-label";

describe("showSectionLabel (F5)", () => {
  it.each(["/dashboard/", "/dashboard", "/dashboard/calendar/", "/dashboard/meetings/", "/dashboard/pipeline/", "/dashboard/notifications/", "/dashboard/intake/", "/dashboard/matters/", "/dashboard/queue/", "/dashboard/documents/", "/dashboard/proposals/", "/dashboard/mail/", "/dashboard/matters/?view=board", "/dashboard/intake?stage=1"])(
    "is hidden where the h1 says the same: %s",
    (path) => expect(showSectionLabel(path)).toBe(false),
  );

  it.each(["/dashboard/leads/abc/", "/dashboard/matters/m1/", "/dashboard/queue/q1/", "/dashboard/proposals/new/", "/dashboard/reports/matters/", "/dashboard/reports/ipos", "/dashboard/settings/modules/", "/dashboard/documents/new/", "/dashboard/zzz/"])(
    "is shown on a deeper page, a report or a settings page: %s",
    (path) => expect(showSectionLabel(path)).toBe(true),
  );

  it("treats a missing path as Today, which hides it", () => {
    expect(showSectionLabel(null)).toBe(false);
    expect(showSectionLabel(undefined)).toBe(false);
  });

  it("sectionLabelFor is unchanged", () => {
    expect(sectionLabelFor("/dashboard/leads/abc/")).toBe("Leads");
    expect(sectionLabelFor("/dashboard/")).toBe("Today");
    expect(sectionLabelFor("/dashboard/reports/matters/")).toBe("Active matters · Report");
  });

  it("the label component draws nothing when hidden, and the layout no longer draws a divider of its own", () => {
    const comp = readFileSync("src/components/shell/SectionLabel.tsx", "utf8");
    expect(comp).toContain("if (!showSectionLabel(pathname)) return null;");
    const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout).not.toContain('<div className="lx-vr" />\n        <SectionLabel />');
  });
});
