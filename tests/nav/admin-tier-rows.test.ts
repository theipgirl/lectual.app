import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { mobileBarItems, moreSections, railGroups, visibleNav, visibleReports } from "@/lib/nav";
import { hubTracks } from "@/lib/onboarding/hub";
import { tourSteps } from "@/lib/onboarding/tour";
import { drawnNav } from "@/lib/views";

const MODULES = ["proposals", "mailbox", "agents", "agent-toolkit", "document-center"];
const ADMIN_TIER: Role[] = ["owner", "admin", "senior_admin"];
const HIDDEN = ["forms", "proposals", "quotes"];

/** Every href the rail draws (rows and children). */
function railHrefs(role: Role): string[] {
  return railGroups(visibleNav(MODULES, role), "/dashboard/").flatMap((g) => g.flatMap((e) => [e.href, ...e.kids.map((k) => k.href)]));
}

describe("Forms and Proposals are drawn for the admin tier only", () => {
  it.each(ROLES)("%s", (role) => {
    const slugs = visibleNav(MODULES, role).map((i) => i.slug);
    const admin = ADMIN_TIER.includes(role);
    expect(slugs.includes("forms")).toBe(admin);
    expect(slugs.includes("proposals")).toBe(admin);
    // The older quotes entry carries the same name: never a back door to a "Proposals" row.
    expect(slugs.includes("quotes")).toBe(false);
    const rail = railHrefs(role);
    expect(rail.some((h) => /^\/dashboard\/(forms|proposals|quotes)\//.test(h))).toBe(admin);
    // The phone bar and More sheet are built from the same list.
    const more = moreSections(visibleNav(MODULES, role), "/dashboard/").flatMap((sec) => sec.items.map((i) => i.slug));
    const bar = mobileBarItems(visibleNav(MODULES, role), "/dashboard/").map((i) => i.slug);
    for (const s of HIDDEN) {
      if (!admin) expect([...more, ...bar]).not.toContain(s);
    }
    if (admin) expect(more).toEqual(expect.arrayContaining(["forms", "proposals"]));
  });

  it("without the proposals feature a staff role sees no Proposals row from the quotes entry either", () => {
    expect(visibleNav([], "attorney").map((i) => i.slug)).not.toEqual(expect.arrayContaining(["quotes"]));
    expect(visibleNav([], "admin").map((i) => i.slug)).toContain("quotes");
  });

  it("an unknown role fails closed", () => {
    const slugs = visibleNav(MODULES, "mystery" as Role).map((i) => i.slug);
    for (const s of HIDDEN) expect(slugs).not.toContain(s);
  });

  it("no hub flow or tour step points at a hidden row for a staff role", () => {
    for (const role of ROLES.filter((r) => !ADMIN_TIER.includes(r))) {
      const paths = hubTracks({ role, modules: MODULES, aiConfigured: true }).flatMap((t) => t.flows.flatMap((f) => f.steps.map((s) => s.path)));
      for (const p of paths) expect(p).not.toMatch(/^\/dashboard\/(forms|proposals|quotes)\//);
      const steps = tourSteps({ role, navItems: visibleNav(MODULES, role), aiConfigured: true, firmName: "Firm" });
      for (const s of steps) expect(s.target ?? "").not.toMatch(/nav-(forms|proposals|quotes)$/);
    }
  });

  it("the Reports index still offers the Intake report to staff (Leads stays visible)", () => {
    expect(visibleReports(visibleNav(MODULES, "paralegal"))).toContain("intake");
  });

  it("the owner view still draws Proposals for the owner", () => {
    expect(drawnNav(visibleNav(MODULES, "owner"), "owner").map((i) => i.slug)).toContain("proposals");
  });
});
