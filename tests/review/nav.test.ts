import { describe, expect, it } from "vitest";
import { NAV, railGroups, visibleNav } from "@/lib/nav";
import { sectionLabelFor, showSectionLabel } from "@/lib/section-label";

describe("Weekly review in the shell", () => {
  it("is one rail row right under Approvals, for every role and with no module", () => {
    for (const role of ["owner", "paralegal", "viewer"] as const) {
      const keys = railGroups(visibleNav([], role), "/dashboard/")[0].map((e) => e.key);
      expect(keys.slice(0, 3)).toEqual(["today", "queue", "review"]);
    }
    expect(NAV.find((n) => n.slug === "review")).toMatchObject({ href: "/dashboard/review/", label: "Weekly review" });
  });
  it("names the section and hides the repeated label on its root", () => {
    expect(sectionLabelFor("/dashboard/review/")).toBe("Weekly review");
    expect(showSectionLabel("/dashboard/review/")).toBe(false);
  });
});
