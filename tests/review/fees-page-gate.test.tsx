import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const members = [{ userId: "u-reb", name: "Rebecca Ames", role: "owner" }];
const fees = { legal: { text: "$1,250.00", from: "proposal" as const }, legalDue: null, gov: { text: "$700.00", from: "proposal" as const }, govDue: null };
const rows = [row({ key: "m-1", client: "Acme Studio", fees })];
const ok = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, failed: [], closeStages: [] };

const order: string[] = [];
let loadSpy = vi.fn();

function mock(role: string | null, opts: { roleViews?: boolean } = {}) {
  order.length = 0;
  loadSpy = vi.fn(async () => {
    order.push("loadReview");
    return ok;
  });
  vi.doMock("@/lib/review/load", () => ({ loadReview: loadSpy }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => {
      order.push("resolveFirmSession");
      return role === null
        ? { kind: "signed-out", redirectTo: "/" }
        : { kind: "ok", role, user: { id: "u-reb", user_metadata: {} }, org: { id: "o1", modules: opts.roleViews ? ["role-views"] : [] }, actingAsStaff: false };
    }),
  }));
  vi.doMock("@/app/dashboard/review/actions", () => ({
    setNextStepAction: vi.fn(), completeNextStepAction: vi.fn(), logWhatHappenedAction: vi.fn(), closeLeadAction: vi.fn(),
    updateNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), moveStageAction: vi.fn(), assignRecordAction: vi.fn(), setSourceAction: vi.fn(),
  }));
  vi.doMock("@/lib/record-card/load", () => ({ loadRecordCard: vi.fn(async () => ({ status: "not-found" })) }));
  vi.doMock("@/lib/review/sheet-edit-load", () => ({ loadSheetStages: vi.fn(async () => ({ matter: [], lead: [] })) }));
  vi.doMock("@/lib/review/detail-load", () => ({
    loadLatestNote: vi.fn(async () => ({ status: "ok", text: "" })),
    loadDeckDocuments: vi.fn(async () => ({ ok: true, read: { files: { status: "ok", files: [], capped: false }, letters: null } })),
  }));
}

async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("../../src/app/dashboard/review/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}
const withFeesOf = () => (loadSpy.mock.calls[0]?.[1] as { withFees?: boolean } | undefined)?.withFees;

describe("the server decides who may see fees", () => {
  beforeEach(() => vi.resetModules());

  it("withFees false for admin, attorney, paralegal, viewer and for an unreadable role; true for owner on the List", async () => {
    for (const [role, expected] of [["owner", true], ["admin", false], ["senior_admin", false], ["attorney", false], ["paralegal", false], ["viewer", false], ["not-a-role", false], [null, false]] as const) {
      vi.resetModules();
      mock(role);
      await render({ view: "sheet" });
      expect(loadSpy, String(role)).toHaveBeenCalledTimes(1);
      expect(withFeesOf(), String(role)).toBe(expected);
    }
  });

  it("false for the owner on the Board (the default) and on Cards: those views pay for no fee read", async () => {
    mock("owner");
    await render();
    expect(withFeesOf()).toBe(false);
    vi.resetModules();
    mock("owner");
    await render({ view: "cards" });
    expect(withFeesOf()).toBe(false);
  });

  it("no search param, cookie or client value can turn it on", async () => {
    mock("attorney");
    await render({ view: "sheet", fees: "1", withFees: "true", canSeeMoney: "1" });
    expect(withFeesOf()).toBe(false);
  });

  it("the session is resolved BEFORE the review is read", async () => {
    mock("owner");
    await render({ view: "sheet" });
    expect(order).toEqual(["resolveFirmSession", "loadReview"]);
  });

  it("the same boolean reaches both tables: fee headers for the owner in the read-only List and in the owner's editable Sheet, nowhere else", async () => {
    // Owner, no role views: the read-only List.
    mock("owner");
    const readOnly = await render({ view: "sheet" });
    expect(readOnly).toContain("rv-sheet");
    expect(readOnly).toContain(">Legal Fee</th>");
    expect(readOnly).toContain("$1,250.00");
    // Owner with role views: the editable Sheet.
    vi.resetModules();
    mock("owner", { roleViews: true });
    const editable = await render({ view: "sheet" });
    expect(editable).toContain("rse-tbl");
    expect(editable).toContain("Legal Fee");
    expect(editable).toContain("$1,250.00");
    // Everyone else, in both looks: no fee header, cell or chooser entry, even though the (mocked) loader handed fee data to the page.
    for (const role of ["admin", "attorney", "paralegal", "viewer"]) {
      for (const roleViews of [false, true]) {
        vi.resetModules();
        mock(role, { roleViews });
        const html = await render({ view: "sheet" });
        expect(html, `${role} ${roleViews}`).not.toMatch(/Legal Fee|Government Filing|\$1,250|\$700\.00/);
        expect(html, `${role} ${roleViews}`).not.toContain("Fee Due Date");
      }
    }
  });
});

describe("page.tsx source", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/review/page.tsx"), "utf8");
  it("derives canSeeMoney and withFees from canSeeBilling( on the session role; the session is awaited before loadReview", () => {
    expect(src).toMatch(/canSeeBilling\(role\)/);
    expect(src).toMatch(/const canSeeMoney = canSeeBilling\(/);
    expect(src).toMatch(/const withFees = canSeeMoney && params\.view === "sheet"/);
    // Sprint 2: the List also asks for the firm's custom columns (withCustom, the view alone, no role); withFees is still the money gate.
    // Merge with the Notes cell: the List's Notes column is asked for in the same call (`notes`, the view alone, no role).
    // Nov 23: custom Money columns are owner-only too, from the same re-resolved role (changed on purpose).
    expect(src).toMatch(/loadReview\(new Date\(\), \{ withFees, withCustom, notes, customMoney \}\)/);
    // Nov 23 follow-up: a REAL owner only, so Lectual staff acting inside the firm (owner role claim) are excluded (changed on purpose).
    expect(src).toMatch(/const actingAsStaff = session\.kind === "ok" \? session\.actingAsStaff : true;/);
    expect(src).toMatch(/const customMoney = canSeeCustomMoney\(role, actingAsStaff\)/);
    expect(src).toMatch(/const withCustom = params\.view === "sheet"/);
    // View as (changed on purpose): the page reads the session as the VIEWER sees it; the order is unchanged.
    expect(src.indexOf("await resolveViewSession()")).toBeGreaterThan(-1);
    expect(src.indexOf("await resolveViewSession()")).toBeLessThan(src.indexOf("await loadReview("));
    expect(src).not.toMatch(/Promise\.all\(\[loadReview/);
    // the role comes from the resolved session, never from the request
    expect(src).not.toMatch(/sp\.(fees|canSeeMoney|withFees)|searchParams\.(fees|canSeeMoney)/);
  });
  it("passes that same canSeeMoney to the chooser and to SheetView", () => {
    expect(src).toMatch(/<SheetView rows=\{shown\} canSeeMoney=\{canSeeMoney\}/);
    // Nov 23 follow-up: the chooser also gets the real-owner custom money flag (changed on purpose).
    expect(src.match(/canSeeMoney, canSeeCustomMoney: customMoney, hasNotes: NOTES_PRESENT/g)?.length).toBe(2);
    expect(src).toMatch(/canSeeCustomMoney=\{customMoney\}/);
  });
});
