import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { mobileBarItems, moreSections, railGroups, visibleNav } from "@/lib/nav";
import {
  DECK_PATH,
  canSwitchView,
  drawnNav,
  parseViewPref,
  prefAllowed,
  previewableRoles,
  railTreeFor,
  shellFor,
  viewFor,
  viewMenuFor,
  viewPrefValue,
  type ViewPref,
} from "@/lib/views";

const AUTO: ViewPref = { kind: "auto" };
const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];

describe("viewFor", () => {
  it("switch off: the technician view for every role and every preference", () => {
    for (const role of ROLES) {
      for (const pref of [AUTO, { kind: "technician" } as ViewPref, { kind: "as", role: "owner" } as ViewPref]) {
        expect(viewFor({ role, pref, firmHasRoleViews: false, actingAsStaff: false })).toBe("technician");
        expect(viewFor({ role, pref, firmHasRoleViews: false, actingAsStaff: true })).toBe("technician");
      }
    }
  });

  it("switch on: an owner gets the owner view; every other role keeps today's shell (not live yet)", () => {
    for (const role of ROLES) {
      expect(viewFor({ role, pref: AUTO, firmHasRoleViews: true, actingAsStaff: false })).toBe(role === "owner" ? "owner" : "technician");
    }
  });

  it("a person who chose the technician view gets it", () => {
    expect(viewFor({ role: "owner", pref: { kind: "technician" }, firmHasRoleViews: true, actingAsStaff: false })).toBe("technician");
  });

  it("Lectual staff inside a firm always see today's shell: a preview saved on their account never follows them into a firm", () => {
    expect(viewFor({ role: "owner", pref: AUTO, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
    expect(viewFor({ role: "owner", pref: { kind: "technician" }, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
    expect(viewFor({ role: "owner", pref: { kind: "as", role: "owner" }, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
    expect(viewFor({ role: "owner", pref: { kind: "as", role: "attorney" }, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
  });

  it("a preview is honoured only for a person who may preview", () => {
    for (const role of ["admin", "senior_admin"] as Role[]) {
      expect(viewFor({ role, pref: { kind: "as", role: "owner" }, firmHasRoleViews: true, actingAsStaff: false })).toBe("owner");
    }
    for (const role of ["attorney", "paralegal", "intake", "viewer", "social_media", "clerk", "law_clerk"] as Role[]) {
      expect(viewFor({ role, pref: { kind: "as", role: "owner" }, firmHasRoleViews: true, actingAsStaff: false })).toBe("technician");
    }
  });

  it("an unreadable role is the technician view", () => {
    expect(viewFor({ role: null, pref: AUTO, firmHasRoleViews: true, actingAsStaff: false })).toBe("technician");
  });
});

describe("the preference", () => {
  it("parses technician, auto and as:<role>; anything else is auto", () => {
    expect(parseViewPref("technician")).toEqual({ kind: "technician" });
    expect(parseViewPref("auto")).toEqual({ kind: "auto" });
    expect(parseViewPref("as:owner")).toEqual({ kind: "as", role: "owner" });
    for (const raw of [undefined, null, 3, {}, "", "owner", "as:", "as:boss", "AS:owner", "technician "]) expect(parseViewPref(raw)).toEqual(AUTO);
    expect(viewPrefValue({ kind: "as", role: "owner" })).toBe("as:owner");
  });

  it("prefAllowed: technician and auto always; a preview only for a switcher and a live view", () => {
    expect(prefAllowed("technician", "viewer", false)).toEqual({ kind: "technician" });
    expect(prefAllowed("auto", "viewer", false)).toEqual(AUTO);
    expect(prefAllowed("as:owner", "admin", false)).toEqual({ kind: "as", role: "owner" });
    expect(prefAllowed("as:owner", "attorney", true)).toBeNull();
    expect(prefAllowed("as:owner", "attorney", false)).toBeNull();
    expect(prefAllowed("as:attorney", "owner", false)).toBeNull();
    expect(prefAllowed("as:boss", "owner", false)).toBeNull();
    for (const raw of [undefined, "", "owner", 1, "Technician"]) expect(prefAllowed(raw, "owner", false)).toBeNull();
  });

  it("who may switch: owner, admin, senior admin; never Lectual staff acting in a firm", () => {
    expect(ROLES.filter((r) => canSwitchView(r, false))).toEqual(expect.arrayContaining(["owner", "admin", "senior_admin"]));
    expect(ROLES.filter((r) => canSwitchView(r, false))).toHaveLength(3);
    expect(canSwitchView("viewer", true)).toBe(false);
    expect(canSwitchView("owner", true)).toBe(false);
    expect(canSwitchView(null, false)).toBe(false);
    expect(previewableRoles()).toEqual(["owner"]);
  });
});

describe("viewMenuFor", () => {
  it("is absent with the switch off or for a role that may not switch", () => {
    expect(viewMenuFor({ role: "owner", pref: AUTO, firmHasRoleViews: false, actingAsStaff: false, view: "technician" })).toBeUndefined();
    expect(viewMenuFor({ role: "attorney", pref: AUTO, firmHasRoleViews: true, actingAsStaff: false, view: "technician" })).toBeUndefined();
  });

  it("an owner gets the on/off switch and nothing to preview; an admin gets only the preview", () => {
    expect(viewMenuFor({ role: "owner", pref: AUTO, firmHasRoleViews: true, actingAsStaff: false, view: "owner" })).toEqual({ pref: "auto", ownViewLive: true, ownViewOn: true, previewRoles: [] });
    expect(viewMenuFor({ role: "owner", pref: { kind: "technician" }, firmHasRoleViews: true, actingAsStaff: false, view: "technician" })?.ownViewOn).toBe(false);
    expect(viewMenuFor({ role: "admin", pref: AUTO, firmHasRoleViews: true, actingAsStaff: false, view: "technician" })).toEqual({ pref: "auto", ownViewLive: false, ownViewOn: false, previewRoles: ["owner"] });
    expect(viewMenuFor({ role: "owner", pref: AUTO, firmHasRoleViews: true, actingAsStaff: true, view: "technician" })).toBeUndefined();
  });
});

describe("drawnNav", () => {
  it("the technician view is the same list, untouched", () => {
    const items = visibleNav(ALL, "owner");
    expect(drawnNav(items, "technician")).toBe(items);
    expect(drawnNav(items, "attorney")).toBe(items);
  });

  it.each(ROLES)("never adds a section %s cannot see", (role) => {
    for (const modules of [[], ALL, ["proposals"]]) {
      const items = visibleNav(modules, role);
      const allowed = new Set(items.map((i) => i.slug));
      for (const i of drawnNav(items, "owner")) expect(allowed.has(i.slug)).toBe(true);
    }
  });

  it("owner: Today, Approvals (the deck), Weekly review, Proposals, Leads, Matters, Calendar; no Settings", () => {
    const drawn = drawnNav(visibleNav(ALL, "owner"), "owner");
    expect(drawn.map((i) => i.slug)).toEqual(["", "queue", "review", "proposals", "intake", "matters", "calendar"]);
    expect(drawn.find((i) => i.slug === "queue")?.href).toBe(DECK_PATH);
    expect(drawnNav(visibleNav([], "owner"), "owner").map((i) => i.slug)).toEqual(["", "queue", "review", "quotes", "intake", "matters", "calendar"]);
  });

  it("the owner rail: four rows and a More parent; Approvals opens the deck and stays active on the list and an item", () => {
    const drawn = drawnNav(visibleNav(ALL, "owner"), "owner");
    const groups = railGroups(drawn, "/dashboard/queue/abc/", railTreeFor("owner")!);
    expect(groups.map((g) => g.map((e) => e.label))).toEqual([["Today", "Approvals", "Weekly review", "Client proposals"], ["More"]]);
    expect(groups[0][1]).toMatchObject({ href: DECK_PATH, active: true, countKey: "queue" });
    expect(groups[1][0].kids.map((k) => k.label)).toEqual(["Leads", "All matters", "Calendar"]);
    expect(groups[1][0].href).toBe("/dashboard/intake/");
  });

  it("the owner phone bar and More sheet: no Reports, no Settings", () => {
    const shell = shellFor("owner");
    const drawn = drawnNav(visibleNav(ALL, "owner"), "owner");
    const bar = mobileBarItems(drawn, "/dashboard/review/", shell.bar);
    expect(bar.map((i) => i.label)).toEqual(["Today", "Approvals", "Review", "Proposals"]);
    expect(bar.find((i) => i.slug === "review")?.active).toBe(true);
    expect(bar.find((i) => i.slug === "queue")?.href).toBe(DECK_PATH);
    const sheet = moreSections(drawn, "/dashboard/review/", shell.moreGroups, shell.bar);
    expect(sheet.map((g) => g.label)).toEqual(["More"]);
    expect(sheet[0].items.map((i) => i.label)).toEqual(["Leads", "Matters", "Calendar"]);
    for (const g of sheet) for (const i of g.items) expect(i.href).not.toMatch(/reports|settings/);
  });

  it("shellFor: the technician view uses every default", () => {
    expect(shellFor("technician")).toEqual({ view: "technician", tree: undefined, bar: undefined, moreGroups: undefined, showSettings: true, showReports: true, settingsInMenu: false, variant: undefined });
    expect(railTreeFor("technician")).toBeNull();
  });
});
