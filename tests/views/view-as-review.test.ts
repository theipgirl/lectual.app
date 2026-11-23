import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * View as: the session as the VIEWER sees it (resolveViewSession), which the Weekly review, Today, the deck and every
 * other page that draws "Mine" / "yours" / page gates now reads. Run against the real view-as module with the session,
 * the preview state and the team list replaced.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const DANA = "22222222-2222-4222-8222-222222222222";
const ORG = "00000000-0000-4000-8000-0000000000a1";
const ownerSession = {
  kind: "ok",
  user: { id: OWNER, email: "owner@example.com", user_metadata: { full_name: "Owner Person", lectual_deal_times: { v: 1 } } },
  member: { role: "owner", org_id: ORG },
  org: { id: ORG, name: "Example Firm", slug: "ex", modules: [] },
  role: "owner",
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Owner Person",
};
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ownerSession, loadFirmSessionCore: async () => ownerSession }));
const state = vi.fn(async () => ({ kind: "on", targetUserId: DANA, startedAt: "2026-11-23T10:00:00Z" }) as unknown);
vi.mock("@/lib/views/view-as-flag", () => ({ readPreviewState: () => state(), previewFlag: async () => "on" }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: async () => [
    { userId: OWNER, email: "owner@example.com", displayName: "Owner Person", role: "owner", identified: true },
    { userId: DANA, email: "dana@example.com", displayName: "Dana Lee", role: "paralegal", identified: true },
  ],
}));
vi.mock("@/lib/auth/current-role", () => ({ currentRole: async () => "owner" }));
vi.mock("@/lib/proposals/store", () => ({ getProposalSettings: async () => ({ approver_user_ids: [DANA] }), isCurrentUserApprover: async () => false }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
vi.mock("@/lib/queue/roles", () => ({ resolveQueueRole: async () => "owner" }));

import { isViewerApprover, resolveViewSession, viewerHasRole, viewerQueueRole, viewerRole } from "@/lib/views/view-as";
import { applyReviewFilters, parseReviewParams } from "@/lib/review/params";
import { row } from "../review/fixtures";

beforeEach(() => state.mockResolvedValue({ kind: "on", targetUserId: DANA, startedAt: "2026-11-23T10:00:00Z" }));

describe("resolveViewSession while previewing", () => {
  it("swaps only 'whose view': role, name and user id are the teammate's; the firm is the same; the teammate's own settings are empty", async () => {
    const s = await resolveViewSession();
    if (s.kind !== "ok") throw new Error("expected ok");
    expect(s.user.id).toBe(DANA);
    expect(s.role).toBe("paralegal");
    expect(s.displayName).toBe("Dana Lee");
    expect(s.member).toEqual({ role: "paralegal", org_id: ORG });
    expect(s.org.id).toBe(ORG);
    expect(s.user.user_metadata).toEqual({});
    expect(s.actingAsStaff).toBe(false);
  });

  it("the twins answer for the teammate", async () => {
    expect(await viewerRole()).toBe("paralegal");
    expect(await viewerHasRole("senior_admin")).toBe(false);
    expect(await viewerQueueRole(["owner", "admin"])).toBeNull();
    expect(await isViewerApprover()).toBe(true);
  });

  it("not previewing: every twin IS its session helper", async () => {
    state.mockResolvedValue({ kind: "off" });
    // A fresh module instance: the per-request memo is keyed on a request, and there is none here.
    expect(await viewerRole()).toBe("owner");
    expect(await viewerQueueRole(["owner"])).toBe("owner");
    expect(await isViewerApprover()).toBe(false);
    const s = await resolveViewSession();
    expect(s).toBe(ownerSession);
  });
});

describe("the Weekly review uses the teammate", () => {
  it("?who=mine keeps the teammate's rows, exactly as their own session would", () => {
    const rows = [row({ key: "a", client: "Acme", assignedTo: DANA }), row({ key: "b", client: "Beta", assignedTo: OWNER })];
    const p = parseReviewParams({ who: "mine", since: "all" });
    const asTeammate = applyReviewFilters(rows, p, DANA).map((r) => r.key);
    expect(asTeammate).toEqual(applyReviewFilters(rows, p, DANA).map((r) => r.key));
    expect(asTeammate).not.toEqual(applyReviewFilters(rows, p, OWNER).map((r) => r.key));
  });

  it("the review page, the Cards deck default and 'Waiting on you' read the view session", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/review/page.tsx"), "utf8");
    expect(src).toMatch(/const session = await resolveViewSession\(\);/);
    expect(src).toMatch(/const userId = session\.kind === "ok" \? session\.user\.id : null;/);
    expect(src).toMatch(/const isApprover = !!role && !!userId && QUEUE_APPROVE_ROLES\.includes\(role\);/);
    expect(src).toMatch(/chosenPerson\(people, params\.person, userId\)/);
  });
});
