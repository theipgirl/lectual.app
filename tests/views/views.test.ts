import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/roles";
import { mobileBarItems, moreSections, railGroups, visibleNav } from "@/lib/nav";
import {
  DECK_PATH,
  NO_PREVIEW,
  VIEW_PREVIEW_KEY,
  VIEW_PREVIEW_MAX,
  canSwitchView,
  drawnNav,
  parsePreviewMap,
  parseViewPref,
  prefAllowed,
  previewFor,
  previewableRoles,
  railTreeFor,
  shellFor,
  viewFor,
  viewMenuFor,
  viewPrefValue,
  withPreview,
  type ViewPref,
} from "@/lib/views";

const AS_OWNER: ViewPref = { kind: "as", role: "owner" };
const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];
const FIRM_A = "11111111-1111-4111-8111-111111111111";
const FIRM_B = "22222222-2222-4222-8222-222222222222";

describe("viewFor", () => {
  it("switch off: the technician view for every role, staff or not, whatever the preview", () => {
    for (const role of ROLES) {
      for (const preview of [NO_PREVIEW, AS_OWNER]) {
        expect(viewFor({ role, preview, firmHasRoleViews: false, actingAsStaff: false })).toBe("technician");
        expect(viewFor({ role, preview, firmHasRoleViews: false, actingAsStaff: true })).toBe("technician");
      }
    }
  });

  it("switch on: a firm member's view is their role's alone (owner -> owner view, everyone else today's shell)", () => {
    for (const role of ROLES) {
      for (const preview of [NO_PREVIEW, AS_OWNER, { kind: "as", role: "attorney" } as ViewPref]) {
        expect(viewFor({ role, preview, firmHasRoleViews: true, actingAsStaff: false })).toBe(role === "owner" ? "owner" : "technician");
      }
    }
  });

  it("Lectual staff in a firm: the technician view by default, the preview they chose for this firm otherwise", () => {
    expect(viewFor({ role: "owner", preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
    expect(viewFor({ role: "owner", preview: AS_OWNER, firmHasRoleViews: true, actingAsStaff: true })).toBe("owner");
    // A view that is not live is never drawn, even as a preview.
    expect(viewFor({ role: "owner", preview: { kind: "as", role: "attorney" }, firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
  });

  it("an unreadable role is the technician view", () => {
    expect(viewFor({ role: null, preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: false })).toBe("technician");
  });
});

describe("the staff preview, kept per firm", () => {
  it("parses as:<role>; anything else is technician", () => {
    expect(parseViewPref("as:owner")).toEqual(AS_OWNER);
    for (const raw of [undefined, null, 3, {}, "", "owner", "auto", "technician", "as:", "as:boss", "AS:owner"]) expect(parseViewPref(raw)).toEqual(NO_PREVIEW);
    expect(viewPrefValue(AS_OWNER)).toBe("as:owner");
    expect(viewPrefValue(NO_PREVIEW)).toBe("technician");
  });

  it("a preview stored for firm A applies in firm A only", () => {
    const meta = { [VIEW_PREVIEW_KEY]: { [FIRM_A]: "as:owner" } };
    expect(previewFor(meta, FIRM_A)).toEqual(AS_OWNER);
    expect(previewFor(meta, FIRM_B)).toEqual(NO_PREVIEW);
    expect(viewFor({ role: "owner", preview: previewFor(meta, FIRM_B), firmHasRoleViews: true, actingAsStaff: true })).toBe("technician");
    expect(viewFor({ role: "owner", preview: previewFor(meta, FIRM_A), firmHasRoleViews: true, actingAsStaff: true })).toBe("owner");
  });

  it("the old account-wide lectual_view is never read", () => {
    expect(previewFor({ lectual_view: "as:owner" }, FIRM_A)).toEqual(NO_PREVIEW);
  });

  it("the stored map is cleaned: org ids only, live previews only, at most the cap", () => {
    expect(parsePreviewMap(null)).toEqual({});
    expect(parsePreviewMap(["as:owner"])).toEqual({});
    expect(parsePreviewMap({ [FIRM_A]: "as:owner", "not-an-id": "as:owner", [FIRM_B]: "as:attorney" })).toEqual({ [FIRM_A]: "as:owner" });
    const many = Object.fromEntries(Array.from({ length: VIEW_PREVIEW_MAX + 5 }, (_, i) => [`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, "as:owner"]));
    expect(Object.keys(parsePreviewMap(many))).toHaveLength(VIEW_PREVIEW_MAX);
  });

  it("withPreview sets or removes this firm's entry and keeps the others", () => {
    const start = { [FIRM_B]: "as:owner" };
    expect(withPreview(start, FIRM_A, AS_OWNER)).toEqual({ [FIRM_B]: "as:owner", [FIRM_A]: "as:owner" });
    expect(withPreview({ [FIRM_A]: "as:owner", [FIRM_B]: "as:owner" }, FIRM_A, NO_PREVIEW)).toEqual({ [FIRM_B]: "as:owner" });
    expect(withPreview(undefined, FIRM_A, NO_PREVIEW)).toEqual({});
  });

  it("prefAllowed: technician, or a preview of a live view; nothing else", () => {
    expect(prefAllowed("technician")).toEqual(NO_PREVIEW);
    expect(prefAllowed("as:owner")).toEqual(AS_OWNER);
    for (const raw of [undefined, "", "auto", "owner", 1, "Technician", "as:attorney", "as:boss"]) expect(prefAllowed(raw)).toBeNull();
    expect(previewableRoles()).toEqual(["owner"]);
  });

  it("who may switch: Lectual staff acting in a firm with role views; never a firm member", () => {
    expect(canSwitchView({ actingAsStaff: true, firmHasRoleViews: true })).toBe(true);
    expect(canSwitchView({ actingAsStaff: true, firmHasRoleViews: false })).toBe(false);
    expect(canSwitchView({ actingAsStaff: false, firmHasRoleViews: true })).toBe(false);
  });
});

describe("viewMenuFor", () => {
  it("is absent for every firm member (owner, admin, senior admin included) and with the switch off", () => {
    for (const actingAsStaff of [false, true]) {
      expect(viewMenuFor({ preview: NO_PREVIEW, firmHasRoleViews: false, actingAsStaff })).toBeUndefined();
    }
    expect(viewMenuFor({ preview: AS_OWNER, firmHasRoleViews: true, actingAsStaff: false })).toBeUndefined();
  });

  it("staff get Technician view (current by default) and the live views to preview", () => {
    expect(viewMenuFor({ preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: true })).toEqual({ pref: "technician", previewRoles: ["owner"] });
    expect(viewMenuFor({ preview: AS_OWNER, firmHasRoleViews: true, actingAsStaff: true })).toEqual({ pref: "as:owner", previewRoles: ["owner"] });
    expect(viewMenuFor({ preview: { kind: "as", role: "attorney" }, firmHasRoleViews: true, actingAsStaff: true })?.pref).toBe("technician");
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
