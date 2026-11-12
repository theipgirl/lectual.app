import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { qitem, U } from "./routing-fixtures";

/** The deck page: gated, three-state, and "All decided" only for a reached, empty queue. */

const state = vi.hoisted(() => ({ role: "attorney", now: null as string | null, modules: ["role-views"], loads: {} as Record<string, unknown>, cardState: { status: "ok", events: [] } as unknown }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => state.modules.includes(m)) }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: vi.fn(async () => ({ kind: "ok", user: { id: U.rebecca, email: "rebecca@example.com" }, role: state.role, org: { id: "org-1" } })),
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

vi.mock("@/lib/deal/times", async (orig) => orig());
const { default: DeckPage } = await import("@/app/dashboard/queue/deck/page");
const render = async (search: Record<string, string> = {}) => renderToStaticMarkup(await DeckPage({ searchParams: Promise.resolve(search) }));
const empty = { status: "ok", items: [] };

beforeEach(() => {
  state.role = "attorney";
  state.modules = ["role-views"];
  state.loads = { pending: empty, approved: empty, rejected: empty };
  state.cardState = { status: "ok", events: [] };
});

describe("the Change deal times opener", () => {
  it.each(["cards", "list", "board"])("is drawn for the owner view (%s)", async (view) => {
    state.role = "owner";
    expect(await render({ view })).toContain("Change deal times");
  });
  it.each(["cards", "list", "board"])("is not drawn for a role in the technician view (%s)", async (view) => {
    for (const role of ["attorney", "paralegal", "admin"]) {
      state.role = role;
      expect(await render({ view })).not.toContain("Change deal times");
    }
  });
  it("is not drawn when the queue can't be read, unless the owner view", async () => {
    state.loads.pending = { status: "unavailable", items: [] };
    state.role = "attorney";
    expect(await render()).not.toContain("Change deal times");
    state.role = "owner";
    expect(await render()).toContain("Change deal times");
  });
});

describe("the deck page", () => {
  it("is notFound without the switch", async () => {
    state.modules = [];
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an ok, empty queue says All decided with the next deal", async () => {
    expect(await render()).toMatch(/All decided\.(<br\/>| )Next deal (7:00 AM|2:00 PM)\./);
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

  it("before 7:00 with cards queued: says how many and when, never All decided", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T10:00:00Z")); // 5:00 AM New York, before the first deal
    try {
      state.loads.pending = { status: "ok", items: [qitem({ id: "e1", created_at: "2026-11-10T09:30:00Z" }), qitem({ id: "e2", created_at: "2026-11-10T09:40:00Z" })] };
      const h = await render();
      expect(h).toContain("Nothing to decide right now.");
      expect(h).toMatch(/2 more at 7:00 AM\./);
      expect(h).not.toMatch(/All decided/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("all of the viewer's cards in Later: N cards back at the next deal", async () => {
    state.loads.pending = { status: "ok", items: [qitem({ id: "l1" }), qitem({ id: "l2", agent: "morning-brief", headline: "Follow-up for a stalled lead: Bo" })] };
    const until = new Date(Date.now() + 3 * 3600_000).toISOString();
    state.cardState = {
      status: "ok",
      events: ["l1", "l2"].map((id) => ({ queueItemId: id, kind: "later", actorId: U.rebecca, targetUserId: null, until, note: null, createdAt: "2026-11-10T01:00:00Z" })),
    };
    const h = await render();
    expect(h).toMatch(/2 cards are back (today|tomorrow) at \d{1,2}:\d{2} (AM|PM)\./);
    expect(h).not.toMatch(/All decided/);
  });

  it("all handed to colleagues: says how many", async () => {
    state.loads.pending = { status: "ok", items: [qitem({ id: "h1" })] };
    state.cardState = { status: "ok", events: [{ queueItemId: "h1", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: null, createdAt: "2026-11-10T01:00:00Z" }] };
    const h = await render();
    expect(h).toContain("1 handed to a colleague.");
    expect(h).not.toMatch(/All decided/);
  });

  it.each(["viewer", "paralegal"])("a %s with no cards is told there is nothing for them, with no Yes", async (role) => {
    state.role = role;
    state.loads.pending = { status: "ok", items: [qitem({ id: "pc" })] };
    const h = await render();
    expect(h).toContain("There is nothing for you to decide here.");
    expect(h).not.toMatch(/All decided/);
    expect(h).not.toMatch(/>Yes</);
  });

  it("when the hand-off read fails every card is still shown, with the note", async () => {
    state.cardState = { status: "unavailable" };
    state.loads.pending = { status: "ok", items: [qitem({ id: "a", headline: "First one", created_at: "2026-11-01T10:00:00Z" }), qitem({ id: "b", headline: "Second one", created_at: "2026-11-02T10:00:00Z" })] };
    const h = await render();
    expect(h).toContain("1 / 2");
    expect(h).toContain("Hand-offs and Later couldn&#x27;t be loaded, so every card is shown.");
  });
});
