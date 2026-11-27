import { describe, expect, it, vi } from "vitest";

import { ROLES, type Role } from "@/lib/auth/roles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { mobileBarItems, moreSections, railGroups, visibleNav } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { NO_PREVIEW, drawnNav, liveViewOf, previewableRoles, railTreeFor, shellFor, viewFor, viewMenuFor } from "@/lib/views";

const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];
const TEAM_ROLES: Role[] = ["admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"];
const MODULE_SETS: string[][] = [[], ["mailbox"], ["proposals"], ALL];

describe("the team view", () => {
  it("every non-owner staff role maps to it; owner, viewer and social media do not", () => {
    for (const role of TEAM_ROLES) expect(liveViewOf(role)).toBe("team");
    expect(liveViewOf("owner")).toBe("owner");
    expect(liveViewOf("viewer")).toBe("technician");
    expect(liveViewOf("social_media")).toBe("technician");
  });

  it("firm members get it with role-views on; with it off every role keeps today's shell", () => {
    for (const role of TEAM_ROLES) {
      expect(viewFor({ role, preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: false })).toBe("team");
      expect(viewFor({ role, preview: NO_PREVIEW, firmHasRoleViews: false, actingAsStaff: false })).toBe("technician");
    }
  });

  it("Lectual staff can preview it, and firm members still have no switch", () => {
    expect(viewFor({ role: "owner", preview: { kind: "as", role: "paralegal" }, firmHasRoleViews: true, actingAsStaff: true })).toBe("team");
    expect(previewableRoles()).toContain("paralegal");
    expect(previewableRoles()).not.toContain("viewer");
    expect(viewMenuFor({ preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: true })?.previewRoles).toEqual(previewableRoles());
    expect(viewMenuFor({ preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: false })).toBeUndefined();
  });

  it("rail: exactly Today, Weekly review, Matters, Approvals; no More, Reports or Settings; Approvals keeps its own list", () => {
    const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");
    const groups = railGroups(drawn, "/dashboard/queue/", railTreeFor("team")!);
    expect(groups.map((g) => g.map((e) => e.label))).toEqual([["Today", "Weekly review", "Matters", "Approvals"]]);
    const queue = groups[0][3];
    expect(queue).toMatchObject({ href: "/dashboard/queue/", active: true, countKey: "queue" });
    const shell = shellFor("team");
    const html = renderToStaticMarkup(createElement(Rail, { items: drawn, queueStatus: "ok", pendingCount: 0, counts: {}, initialPinned: false, tree: shell.tree, showSettings: shell.showSettings, showReports: shell.showReports }));
    for (const gone of ["More", "Reports", "Settings", "lx-rail-chev", "lx-rail--team", "/dashboard/reports"]) expect(html, gone).not.toContain(gone);
  });

  it("phone bar: exactly Today, Review, Matters, Approvals; no More button and no sheet", () => {
    const shell = shellFor("team");
    const drawn = drawnNav(visibleNav(ALL, "intake"), "team");
    expect(mobileBarItems(drawn, "/dashboard/", shell.bar).map((i) => i.label)).toEqual(["Today", "Review", "Matters", "Approvals"]);
    expect(shell.showMore).toBe(false);
    const html = renderToStaticMarkup(createElement(MobileBar, { items: drawn, queueStatus: "ok", pendingCount: 0, counts: {}, bar: shell.bar, groups: shell.moreGroups, reports: shell.showReports, more: shell.showMore }));
    expect(html).not.toContain("More");
    expect(html).not.toContain("lx-more-sheet");
    expect(html).not.toContain("aria-haspopup");
    // The owner and technician bars still draw More.
    const o = shellFor("owner");
    expect(renderToStaticMarkup(createElement(MobileBar, { items: drawnNav(visibleNav(ALL, "owner"), "owner"), queueStatus: "ok", pendingCount: 0, counts: {}, bar: o.bar, groups: o.moreGroups, reports: o.showReports, more: o.showMore, variant: "owner" }))).toContain("More");
    expect(renderToStaticMarkup(createElement(MobileBar, { items: visibleNav(ALL, "paralegal"), queueStatus: "ok", pendingCount: 0, counts: {} }))).toContain("More");
  });

  it("settings is in the account menu, not the rail; no tour or hub variant (technician look)", () => {
    expect(shellFor("team")).toMatchObject({ showSettings: false, showReports: false, showMore: false, settingsInMenu: true, variant: undefined });
    expect(shellFor("technician").showMore).toBeUndefined();
    expect(shellFor("owner").showMore).toBeUndefined();
  });

  it.each(ROLES.filter((r) => liveViewOf(r) === "team"))("%s: the team view draws only the four rows, and only those the role and firm allow (draw-only)", (role) => {
    for (const modules of MODULE_SETS) {
      const items = visibleNav(modules, role);
      const drawn = drawnNav(items, "team");
      const allowed = new Set(items.map((i) => i.slug));
      for (const i of drawn) {
        expect(allowed.has(i.slug)).toBe(true);
        expect(["", "review", "matters", "queue"]).toContain(i.slug);
      }
      const entries = railGroups(drawn, "/dashboard/", railTreeFor("team")!).flat();
      expect(entries.every((e) => e.kids.length === 0)).toBe(true);
    }
  });

  it("a section the firm lacks never appears, and the hidden ones are not drawn", () => {
    const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team").map((i) => i.slug);
    for (const gone of ["mail", "agents", "skills", "proposals", "intake", "calendar", "settings"]) expect(drawn).not.toContain(gone);
  });

  it("technician and owner shells are untouched by the team change (More and Reports stay)", () => {
    const tech = shellFor("technician");
    expect(tech.tree).toBeUndefined();
    const techGroups = railGroups(visibleNav(ALL, "paralegal"), "/dashboard/").flat().map((e) => e.label);
    expect(techGroups).toContain("Communication");
    const owner = railGroups(drawnNav(visibleNav(ALL, "owner"), "owner"), "/dashboard/", railTreeFor("owner")!);
    expect(owner.flat().map((e) => e.label)).toContain("More");
    expect(moreSections(drawnNav(visibleNav(ALL, "owner"), "owner"), "/dashboard/", shellFor("owner").moreGroups, shellFor("owner").bar).map((g) => g.label)).toEqual(["More"]);
  });

  it("the owner's More row keeps its menu chevron; the technician rail has none", () => {
    const base = { queueStatus: "ok" as const, pendingCount: 0, counts: {}, initialPinned: false };
    const tech = renderToStaticMarkup(createElement(Rail, { ...base, items: visibleNav(ALL, "paralegal") }));
    expect(tech).not.toContain("lx-rail-chev");
    const owner = renderToStaticMarkup(createElement(Rail, { ...base, items: drawnNav(visibleNav(ALL, "owner"), "owner"), tree: shellFor("owner").tree, variant: "owner", showSettings: false, showReports: false }));
    expect(owner).toContain("lx-rail-chev");
  });
});
