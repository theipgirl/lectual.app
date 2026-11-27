import { describe, expect, it, vi } from "vitest";

import { ROLES, type Role } from "@/lib/auth/roles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { mobileBarItems, moreSections, railGroups, visibleNav, visibleReports, type NavItem } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
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

  it("rail: Today, Weekly review, Matters, Approvals, then More; Approvals keeps its own list", () => {
    const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");
    const groups = railGroups(drawn, "/dashboard/queue/", railTreeFor("team")!);
    expect(groups.map((g) => g.map((e) => e.label))).toEqual([["Today", "Weekly review", "Matters", "Approvals"], ["More"]]);
    const queue = groups[0][3];
    expect(queue).toMatchObject({ href: "/dashboard/queue/", active: true, countKey: "queue" });
    expect(groups.flat().some((e) => e.label === "Settings" || e.label === "Reports")).toBe(false);
  });

  it("phone bar: Today, Review, Matters, Approvals; More holds the rest", () => {
    const shell = shellFor("team");
    const drawn = drawnNav(visibleNav(ALL, "intake"), "team");
    expect(mobileBarItems(drawn, "/dashboard/", shell.bar).map((i) => i.label)).toEqual(["Today", "Review", "Matters", "Approvals"]);
    const sheet = moreSections(drawn, "/dashboard/", shell.moreGroups, shell.bar);
    expect(sheet.map((g) => g.label)).toEqual(["More"]);
    const railMore = railGroups(drawn, "/dashboard/", shell.tree)[1][0].kids.map((k) => k.href);
    expect(sheet[0].items.map((i) => i.href)).toEqual(railMore);
  });

  it("settings is in the account menu, not the rail; no tour or hub variant (technician look)", () => {
    expect(shellFor("team")).toMatchObject({ showSettings: false, showReports: true, settingsInMenu: true, variant: undefined });
  });

  it.each(ROLES.filter((r) => liveViewOf(r) === "team"))("%s: every technician rail route is still reachable from the team rail or its More (draw-only)", (role) => {
    for (const modules of MODULE_SETS) {
      const items = visibleNav(modules, role);
      const drawn = drawnNav(items, "team");
      const entries = railGroups(drawn, "/dashboard/", railTreeFor("team")!).flat();
      const reachable = new Set(entries.flatMap((e) => [e.key, ...e.kids.map((k) => k.key)]));
      for (const item of items) {
        if (item.slug === "settings") continue; // the account menu
        expect(reachable.has(item.slug || "today"), `${role} ${item.slug} with ${modules.join(",")}`).toBe(true);
      }
      // Never a section the role or firm cannot see.
      const allowed = new Set(items.map((i) => i.slug));
      for (const i of drawn) expect(allowed.has(i.slug)).toBe(true);
      // The phone More sheet and bar together reach the same set.
      const shell = shellFor("team");
      const phone = new Set([...mobileBarItems(drawn, "/dashboard/", shell.bar).map((i) => i.slug), ...moreSections(drawn, "/dashboard/", shell.moreGroups, shell.bar).flatMap((g) => g.items.map((i) => i.slug))]);
      for (const item of items) if (item.slug !== "settings") expect(phone.has(item.slug), `phone ${role} ${item.slug}`).toBe(true);
    }
  });

  it("a section the firm lacks never appears", () => {
    const drawn = drawnNav(visibleNav([], "paralegal"), "team").map((i) => i.slug);
    for (const gone of ["mail", "agents", "skills", "proposals"]) expect(drawn).not.toContain(gone);
  });

  it("Reports: a team role with a visible report reaches the index from the rail and the phone More sheet; with none, no row", () => {
    const shell = shellFor("team");
    const rail = renderToStaticMarkup(createElement(Rail, { items: drawnNav(visibleNav(ALL, "paralegal"), "team"), queueStatus: "ok", pendingCount: 0, counts: {}, initialPinned: false, tree: shell.tree, showSettings: shell.showSettings, showReports: shell.showReports }));
    expect(rail).toContain("href=\"/dashboard/reports\"");
    const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");
    expect(visibleReports(drawn).length).toBeGreaterThan(0);
    const sheet = moreSections(drawn, "/dashboard/", shell.moreGroups, shell.bar, { reports: shell.showReports });
    expect(sheet.map((g) => g.label)).toEqual(["More", "Reports"]);
    expect(sheet[1].items.every((i) => i.href.startsWith("/dashboard/reports"))).toBe(true);
    // Nothing visible: no report, so no row and no group.
    const none: NavItem[] = [];
    expect(renderToStaticMarkup(createElement(Rail, { items: none, queueStatus: "ok", pendingCount: 0, counts: {}, initialPinned: false, tree: shell.tree, showSettings: false, showReports: true }))).not.toContain("/dashboard/reports");
    expect(moreSections(none, "/dashboard/", shell.moreGroups, shell.bar, { reports: true })).toEqual([]);
    // The owner's sheet is unchanged by the option being absent.
    const o = shellFor("owner");
    const od = drawnNav(visibleNav(ALL, "owner"), "owner");
    expect(moreSections(od, "/dashboard/", o.moreGroups, o.bar).some((g) => g.label === "Reports")).toBe(false);
    expect(o.showReports).toBe(false);
  });

  it("the team More row opens a menu (chevron, no jump to Mail); the owner's keeps its own, technician has none", () => {
    const base = { queueStatus: "ok" as const, pendingCount: 0, counts: {}, initialPinned: false };
    const items = drawnNav(visibleNav(ALL, "paralegal"), "team");
    const team = renderToStaticMarkup(createElement(Rail, { ...base, items, tree: shellFor("team").tree, showSettings: false, showReports: true }));
    expect(team).toContain("lx-rail-chev");
    expect(team).toContain("lx-rail--team");
    const tech = renderToStaticMarkup(createElement(Rail, { ...base, items: visibleNav(ALL, "paralegal") }));
    expect(tech).not.toContain("lx-rail-chev");
    expect(tech).not.toContain("lx-rail--team");
    const owner = renderToStaticMarkup(createElement(Rail, { ...base, items: drawnNav(visibleNav(ALL, "owner"), "owner"), tree: shellFor("owner").tree, variant: "owner", showSettings: false, showReports: false }));
    expect(owner).toContain("lx-rail-chev");
    expect(owner).not.toContain("lx-rail--team");
  });
});
