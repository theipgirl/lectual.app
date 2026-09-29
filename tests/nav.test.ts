import { describe, it, expect } from "vitest";
import { NAV, RAIL_TREE, navItemAllowed, navItemBySlug, railGroups, visibleNav } from "@/lib/nav";

describe("rail sections fail closed on modules", () => {
  it("hides every module-gated section from a firm with no modules", () => {
    const shown = visibleNav([], "owner").map((n) => n.slug);
    for (const item of NAV.filter((n) => n.module)) {
      expect(shown).not.toContain(item.slug);
    }
  });

  it("shows a gated section only to a firm holding that module", () => {
    const mail = navItemBySlug("mail")!;
    expect(mail.module).toBe("mailbox");
    expect(navItemAllowed(mail, ["agents"], "owner")).toBe(false);
    expect(navItemAllowed(mail, ["mailbox"], "viewer")).toBe(true);
  });

  it("gates My Mail on `mailbox` and Agents on `agents`", () => {
    expect(navItemBySlug("mail")?.module).toBe("mailbox");
    expect(navItemBySlug("agents")?.module).toBe("agents");
  });

  it("keeps slugs unique so a URL resolves to exactly one section", () => {
    const slugs = NAV.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("rail tree (design/Rail.dc.html)", () => {
  const labels = (groups: ReturnType<typeof railGroups>) => groups.flat().flatMap((e) => [e.label, ...e.kids.map((k) => k.label)]);

  it("only names real sections", () => {
    for (const group of RAIL_TREE) {
      for (const node of group) {
        const slugs = "slug" in node ? [node.slug] : node.kids;
        for (const slug of slugs) expect(navItemBySlug(slug), slug).toBeDefined();
      }
    }
  });

  it("drops module-gated children for a firm without the module", () => {
    const shown = labels(railGroups(visibleNav([], "owner"), "/dashboard/"));
    expect(shown).not.toContain("My Mail");
    expect(shown).not.toContain("Agents");
    expect(shown).toContain("Queue");
    const withAll = labels(railGroups(visibleNav(["mailbox", "agents"], "owner"), "/dashboard/"));
    expect(withAll).toContain("My Mail");
    expect(withAll).toContain("Agents");
  });

  it("opens the parent of the current page, and a lead's page belongs to Intake", () => {
    const groups = railGroups(visibleNav([], "owner"), "/dashboard/leads/abc/");
    const intake = groups.flat().find((e) => e.label === "Intake")!;
    expect(intake.childActive).toBe(true);
    expect(intake.kids.find((k) => k.label === "PNC")?.active).toBe(true);
    expect(intake.active).toBe(false);
    expect(intake.href).toBe("/dashboard/reports/intake/");
  });

  it("marks Today active only on the home page", () => {
    const today = (path: string) => railGroups(visibleNav([], "owner"), path).flat().find((e) => e.label === "Today")!.active;
    expect(today("/dashboard/")).toBe(true);
    expect(today("/dashboard/matters/")).toBe(false);
  });

  it("opens each parent's report view, and there is no Reports section", () => {
    const groups = railGroups(visibleNav(["mailbox", "agents"], "owner"), "/dashboard/reports/matters/");
    const matters = groups.flat().find((e) => e.label === "Active matters")!;
    expect(matters.active).toBe(true);
    expect(groups.flat().map((e) => e.label)).not.toContain("Reports");
    expect(navItemBySlug("reports")).toBeUndefined();
    for (const e of groups.flat().filter((x) => x.kids.length)) expect(e.href).toMatch(/^\/dashboard\/reports\/[a-z]+\/$/);
  });
});
