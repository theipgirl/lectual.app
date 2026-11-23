import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import {
  canOfferViewAs,
  classifyViewAsError,
  enterDecision,
  enterNotice,
  flagOf,
  isRealOwner,
  noticeBackPath,
  refusesWrites,
  sameOrigin,
  stateFromRpc,
  viewerOf,
  type OwnerFacts,
} from "@/lib/views/view-as-rules";
import { drawnNav, NO_PREVIEW, viewFor } from "@/lib/views";
import { visibleNav } from "@/lib/nav";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000b2";
const ME = "11111111-1111-4111-8111-111111111111";
const TEAMMATE = "22222222-2222-4222-8222-222222222222";

const facts = (role: string | null, memberOrg = ORG): OwnerFacts => ({ userId: ME, orgId: ORG, member: role ? { role, org_id: memberOrg } : null });

describe("who may start View as", () => {
  it("only a real owner row in THIS firm, for every one of the 10 roles", () => {
    for (const role of ROLES) {
      const d = enterDecision({ facts: facts(role), targetUserId: TEAMMATE, targetRole: "paralegal" });
      expect(d.ok, role).toBe(role === "owner");
    }
  });

  it("never the claim: staff standing in a firm with no row (member null) are refused", () => {
    expect(isRealOwner(facts(null))).toBe(false);
    expect(enterDecision({ facts: facts(null), targetUserId: TEAMMATE, targetRole: "paralegal" })).toEqual({ ok: false, reason: "not-allowed" });
  });

  it("platform admins: an owner row in this firm passes; no row or a non-owner row is refused; another firm's row never counts", () => {
    expect(isRealOwner(facts("owner"))).toBe(true); // the demo-firm case
    expect(isRealOwner(facts("admin"))).toBe(false);
    expect(isRealOwner(facts(null))).toBe(false);
    expect(isRealOwner(facts("owner", OTHER_ORG))).toBe(false);
  });

  it("not yourself, not a removed member or someone outside the firm; owners and admins may be previewed", () => {
    expect(enterDecision({ facts: facts("owner"), targetUserId: ME, targetRole: "owner" })).toEqual({ ok: false, reason: "self" });
    expect(enterDecision({ facts: facts("owner"), targetUserId: TEAMMATE, targetRole: null })).toEqual({ ok: false, reason: "gone" });
    expect(enterDecision({ facts: facts("owner"), targetUserId: "not-a-uuid", targetRole: "paralegal" })).toEqual({ ok: false, reason: "gone" });
    expect(enterDecision({ facts: facts("owner"), targetUserId: TEAMMATE, targetRole: "owner" })).toEqual({ ok: true });
    expect(enterDecision({ facts: facts("owner"), targetUserId: TEAMMATE, targetRole: "admin" })).toEqual({ ok: true });
  });

  it("the Team page offers the button only to a real owner, never on their own row", () => {
    expect(canOfferViewAs(facts("owner"), TEAMMATE)).toBe(true);
    expect(canOfferViewAs(facts("owner"), ME)).toBe(false);
    expect(canOfferViewAs(facts("admin"), TEAMMATE)).toBe(false);
    expect(canOfferViewAs(null, TEAMMATE)).toBe(false);
  });
});

describe("the database's answers", () => {
  it("a missing function or table is 'not set up', judged by code only", () => {
    for (const code of ["42883", "PGRST202", "42P01", "PGRST205"]) expect(stateFromRpc({ data: null, error: { code, message: "" } })).toEqual({ kind: "not-set-up" });
    // The same words with another code are NOT read as missing.
    expect(stateFromRpc({ data: null, error: { code: "XX000", message: "function does not exist" } })).toEqual({ kind: "unknown" });
  });

  it("0116's guard missing is 'not set up'; any other failure is 'unknown'", () => {
    expect(stateFromRpc({ data: null, error: { code: "42501", message: "view_as_needs_member_guard: x" } })).toEqual({ kind: "not-set-up" });
    expect(stateFromRpc({ data: null, error: { code: "08006", message: "" } })).toEqual({ kind: "unknown" });
  });

  it("an open row is ON, no row is OFF, a malformed row is unknown (never off)", () => {
    expect(stateFromRpc({ data: [{ target_user_id: TEAMMATE, started_at: "2026-11-23T10:00:00Z" }], error: null })).toEqual({ kind: "on", targetUserId: TEAMMATE, startedAt: "2026-11-23T10:00:00Z" });
    expect(stateFromRpc({ data: [], error: null })).toEqual({ kind: "off" });
    expect(stateFromRpc({ data: [{ target_user_id: 5 }], error: null })).toEqual({ kind: "unknown" });
  });

  it("writes are refused while on or unknown", () => {
    expect(refusesWrites(flagOf({ kind: "on", targetUserId: TEAMMATE, startedAt: "x" }))).toBe(true);
    expect(refusesWrites(flagOf({ kind: "unknown" }))).toBe(true);
    expect(refusesWrites(flagOf({ kind: "off" }))).toBe(false);
    expect(refusesWrites(flagOf({ kind: "not-set-up" }))).toBe(false);
  });

  it("refusal prefixes map to the Team page notices", () => {
    expect(enterNotice(classifyViewAsError({ code: "42501", message: "view_as_not_owner: x" }))).toBe("view-as-not-allowed");
    expect(enterNotice(classifyViewAsError({ code: "23514", message: "view_as_self: x" }))).toBe("view-as-self");
    expect(enterNotice(classifyViewAsError({ code: "23514", message: "view_as_target_not_member: x" }))).toBe("view-as-gone");
    expect(enterNotice(classifyViewAsError({ code: "PGRST202", message: "" }))).toBe("view-as-not-ready");
    expect(enterNotice(classifyViewAsError({ code: "08006", message: "boom" }))).toBe("view-as-failed");
  });
});

describe("resolveViewer swaps only 'whose view'", () => {
  const self = { userId: ME, role: "owner" as Role, displayName: "Owner" };
  const target = { userId: TEAMMATE, role: "paralegal" as Role, displayName: "Dana Lee" };

  it("on: the viewer is the teammate; off / unknown / a missing row: the signed-in person", () => {
    const on = { kind: "on" as const, targetUserId: TEAMMATE, startedAt: "2026-11-23T10:00:00Z" };
    expect(viewerOf({ self, state: on, target })).toEqual({ viewAs: { targetUserId: TEAMMATE, targetRole: "paralegal", targetName: "Dana Lee", startedAt: on.startedAt }, viewer: target });
    expect(viewerOf({ self, state: { kind: "off" }, target }).viewer).toEqual(self);
    expect(viewerOf({ self, state: { kind: "unknown" }, target }).viewer).toEqual(self);
    expect(viewerOf({ self, state: on, target: null })).toEqual({ viewAs: null, viewer: self });
    expect(viewerOf({ self, state: on, target: { ...target, userId: ME } }).viewAs).toBeNull();
  });

  it("role views on and off give the teammate's view and rail", () => {
    for (const firmHasRoleViews of [true, false]) {
      for (const role of ROLES) {
        const asTeammate = viewFor({ role, preview: NO_PREVIEW, firmHasRoleViews, actingAsStaff: false });
        expect(asTeammate).toBe(!firmHasRoleViews ? "technician" : role === "owner" || role === "admin" ? "owner" : "technician");
        const mods = ["mailbox", "agents", "proposals", "role-views"];
        expect(drawnNav(visibleNav(mods, role), asTeammate).map((i) => i.slug)).toEqual(drawnNav(visibleNav(mods, role), viewFor({ role, preview: NO_PREVIEW, firmHasRoleViews, actingAsStaff: false })).map((i) => i.slug));
      }
    }
  });
});

describe("same-site and the notice path", () => {
  it("a POST is same-site only when its Origin (or Referer) is this host", () => {
    expect(sameOrigin("https://app.example.test/dashboard/view-as/exit/", "https://app.example.test", null)).toBe(true);
    expect(sameOrigin("https://app.example.test/x", "https://evil.example", null)).toBe(false);
    expect(sameOrigin("https://app.example.test/x", null, "https://app.example.test/dashboard/")).toBe(true);
    expect(sameOrigin("https://app.example.test/x", null, null)).toBe(false);
  });

  it("a refused redirect-style action goes back to the dashboard page it came from, same origin only", () => {
    expect(noticeBackPath("https://app.example.test/dashboard/matters/?seg=open", "https://app.example.test")).toBe("/dashboard/matters/?seg=open&notice=preview");
    expect(noticeBackPath("https://evil.example/dashboard/x", "https://app.example.test")).toBe("/dashboard/?notice=preview");
    expect(noticeBackPath(null, null)).toBe("/dashboard/?notice=preview");
  });
});
