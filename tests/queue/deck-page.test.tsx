import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { qitem, U } from "./routing-fixtures";

/** The deck page: gated, three-state, and "All decided" only for a reached, empty queue. */

const state = vi.hoisted(() => ({ modules: ["role-views"], loads: {} as Record<string, unknown>, cardState: { status: "ok", events: [] } as unknown }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => state.modules.includes(m)) }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: vi.fn(async () => ({ kind: "ok", user: { id: U.rebecca, email: "rebecca@example.com" }, role: "attorney", org: { id: "org-1" } })),
}));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async (s: string) => state.loads[s]) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => ({ status: "ok", routing: {}, members: [], dropped: 0, settingsExist: true })) }));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => state.cardState) }));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: "The Team", teamSignOff: "The Team", memberNames: [] })) }));
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })), stalenessRequiresConfirm: vi.fn(() => false) }));
vi.mock("@/lib/consult-proposal/link", () => ({ gateLinkedProposal: vi.fn(async () => ({ ok: true, proposal: null })) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
vi.mock("@/app/dashboard/queue/deck/actions", () => ({}));
vi.mock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));

const { default: DeckPage } = await import("@/app/dashboard/queue/deck/page");
const render = async (search: Record<string, string> = {}) => renderToStaticMarkup(await DeckPage({ searchParams: Promise.resolve(search) }));
const empty = { status: "ok", items: [] };

beforeEach(() => {
  state.modules = ["role-views"];
  state.loads = { pending: empty, approved: empty, rejected: empty };
  state.cardState = { status: "ok", events: [] };
});

describe("the deck page", () => {
  it("is notFound without the switch", async () => {
    state.modules = [];
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an ok, empty queue says All decided with the next deal", async () => {
    expect(await render()).toMatch(/All decided\. Next deal (7:00 AM|2:00 PM)\./);
  });

  it.each([
    [{ status: "unavailable", items: [] }, /Can&#x27;t reach approvals right now/],
    [{ status: "unconfigured", reason: "org-key", items: [] }, /Approvals aren&#x27;t switched on for your firm yet/],
  ])("an unreached queue says so and never All decided", async (load, re) => {
    state.loads.pending = load;
    const h = await render();
    expect(h).toMatch(re);
    expect(h).not.toMatch(/All decided/);
  });

  it("deals a card, positioned by id", async () => {
    state.loads.pending = { status: "ok", items: [qitem({ id: "a", headline: "First one", created_at: "2026-11-01T10:00:00Z" }), qitem({ id: "b", headline: "Second one", created_at: "2026-11-02T10:00:00Z" })] };
    const h = await render({ at: "b" });
    expect(h).toContain("2 / 2");
    expect(h).toMatch(/<h2 class="dk-title"[^>]*>Second one</);
    expect(h).toContain("Needs you");
  });

  it("Board keeps a failed Decided today read apart from an empty one", async () => {
    state.loads.approved = { status: "unavailable", items: [] };
    const h = await render({ view: "board" });
    expect(h).toContain("Decided today couldn&#x27;t be loaded");
    expect(h).toContain("Needs your yes");
  });

  it("before the card-events table exists, Board says Hand off and Later aren't switched on", async () => {
    state.cardState = { status: "not-set-up" };
    expect(await render({ view: "board" })).toContain("This isn&#x27;t switched on for your firm yet.");
  });
});
