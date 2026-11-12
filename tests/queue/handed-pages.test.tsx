import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { QueueLoad } from "@/lib/queue/load";
import type { CardState } from "@/lib/queue/deck";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

process.env.__NEXT_TRAILING_SLASH = "true";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const items = [followup({ id: "f1" }), followup({ id: "f2", headline: "Follow-up for a stalled lead: Cy" }), qitem({ id: "p1" })];
const ok = (i = items): QueueLoad => ({ status: "ok", items: i });
const handoff = (id: string, to: string, by = U.rebecca, note: string | null = null) => ({ queueItemId: id, kind: "handoff" as const, actorId: by, targetUserId: to, until: null, note, createdAt: "2026-10-28T09:00:00Z" });

async function renderList(cardState: CardState, viewer: { userId: string; role: string } | null, params: { status?: string; who?: string } = {}, load: QueueLoad = ok()) {
  vi.resetModules();
  const loadCardState = vi.fn(async () => cardState);
  vi.doMock("@/lib/queue/card-state", () => ({ loadCardState }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => load) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ dismissStaleFollowupsAction: vi.fn(), sendBackAction: vi.fn() }));
  vi.doMock("@/lib/queue/view-context", () => ({ loadQueueViewContext: vi.fn(async () => ({ viewer, routing: {}, members: MEMBERS, routingFailed: false, dropped: 0, now: NOW })) }));
  const { default: Page } = await import("../../src/app/dashboard/queue/page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  return { html, loadCardState };
}
const rows = (html: string) => [...html.matchAll(/\/dashboard\/queue\/(f1|f2|p1)\//g)].map((m) => m[1]);
const caitlyn = { userId: U.caitlyn, role: "paralegal" };

beforeEach(() => vi.setSystemTime(NOW));

describe("Approvals page: handed to you (technician shell)", () => {
  it("renders exactly as before when no card is handed to the viewer, whatever the event read says", async () => {
    const base = (await renderList({ status: "ok", events: [] }, caitlyn)).html;
    expect(base).not.toContain("Handed to you");
    expect(base).not.toContain("data-handed-marker");
    expect(base).not.toContain("who=handed");
    for (const cardState of [
      { status: "not-set-up" },
      { status: "unavailable" },
      { status: "ok", events: [handoff("f1", U.taylor)] }, // handed to someone else
      { status: "ok", events: [handoff("f1", U.caitlyn), { ...handoff("f1", U.caitlyn), kind: "returned", targetUserId: null, createdAt: "2026-10-28T10:00:00Z" }] }, // sent back
    ] as CardState[]) {
      expect((await renderList(cardState, caitlyn)).html).toBe(base);
    }
  });

  it("a viewer-less page and the other tabs never read the events at all", async () => {
    expect((await renderList({ status: "ok", events: [handoff("f1", U.caitlyn)] }, null)).loadCardState).not.toHaveBeenCalled();
    for (const status of ["approved", "rejected"]) {
      const r = await renderList({ status: "ok", events: [handoff("f1", U.caitlyn)] }, caitlyn, { status });
      expect(r.loadCardState).not.toHaveBeenCalled();
      expect(r.html).not.toContain("Handed to you");
    }
  });

  it("a card handed to the viewer gets a marker on its row and a pill with the count", async () => {
    const { html } = await renderList({ status: "ok", events: [handoff("f2", U.caitlyn, U.rebecca, "please check")] }, caitlyn, { who: "all" });
    expect(html).toContain("Handed to you (1)");
    expect(html).toContain("who=handed");
    expect(html.match(/data-handed-marker/g)).toHaveLength(1);
    // The marker sits on f2's row, not f1's.
    const f2 = html.slice(html.indexOf("/dashboard/queue/f2/"));
    expect(f2.indexOf("data-handed-marker")).toBeGreaterThan(-1);
    expect(f2.indexOf("data-handed-marker")).toBeLessThan(f2.indexOf("/dashboard/queue/p1/"));
    expect(html).not.toContain("please check"); // the note stays on the card page
  });

  it("?who=handed lists only those cards and marks the pill current", async () => {
    const r = await renderList({ status: "ok", events: [handoff("f2", U.caitlyn)] }, caitlyn, { who: "handed" });
    expect(rows(r.html)).toEqual(["f2"]);
    expect(r.html).toMatch(/aria-current="page"[^>]*>Handed to you \(1\)/);
    expect(r.html).not.toMatch(/aria-current="page"[^>]*>Mine/);
  });

  it("?who=handed without any hand-off (or an unread event table) is just the default page", async () => {
    const plain = (await renderList({ status: "ok", events: [] }, caitlyn)).html;
    expect((await renderList({ status: "ok", events: [] }, caitlyn, { who: "handed" })).html).toBe(plain);
    expect((await renderList({ status: "unavailable" }, caitlyn, { who: "handed" })).html).toBe(plain);
  });

  it("the queue's own three states are untouched: an unreadable queue shows no pill and reads no events", async () => {
    const r = await renderList({ status: "ok", events: [handoff("f1", U.caitlyn)] }, caitlyn, {}, { status: "unavailable", reason: "network" } as QueueLoad);
    expect(r.loadCardState).not.toHaveBeenCalled();
    expect(r.html).not.toContain("Handed to you");
  });
});

async function renderItem(row: ReturnType<typeof qitem>, viewer: { userId: string; role: string }, cardState: CardState, routing: object = {}, search: object = {}) {
  vi.resetModules();
  vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => row) }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "rpb") }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/queue/roles", async (orig) => ({ ...(await orig<object>()), resolveQueueRole: vi.fn(async (_s: unknown, allowed: string[]) => (allowed.includes(viewer.role) ? viewer.role : null)) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })) }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ loadLinkedPanel: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: null, teamSignOff: null, memberNames: [] })) }));
  vi.doMock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => cardState) }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn(), sendBackAction: vi.fn() }));
  vi.doMock("@/lib/queue/view-context", () => ({ loadQueueViewContext: vi.fn(async () => ({ viewer, routing, members: MEMBERS, routingFailed: false, dropped: 0, now: NOW })) }));
  const { default: Page } = await import("../../src/app/dashboard/queue/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: row.id }), searchParams: Promise.resolve(search) })));
}

describe("approval item page: handed to you", () => {
  const row = followup({ id: "q1" });
  const handed: CardState = { status: "ok", events: [handoff("q1", U.caitlyn, U.rebecca, "Please look at the dates")] };

  it("the current hand-off target sees who handed it, when, the note and Send back to that person", async () => {
    const html = await renderItem(row, caitlyn, handed);
    expect(html).toContain("data-handed-to-you");
    expect(html).toContain("Handed to you by Rebecca · ");
    expect(html).toContain("Please look at the dates");
    expect(html).toContain("Send back to Rebecca");
    expect(html).toContain("Add a note (optional)");
    expect(html).toMatch(/<textarea[^>]*maxLength="500"|<textarea[^>]*maxlength="500"/i);
  });

  it("says why the yes is elsewhere only when canApproveItem is false, and not twice", async () => {
    const cant = await renderItem(row, caitlyn, handed, { stalled_followup: U.rebecca });
    expect(cant).toContain("This one is for Rebecca. You can edit it and send it back.");
    expect(cant).not.toContain("data-queue-refusal");
    expect(cant).not.toContain(">Approve<");
    // An owner handed the card may approve it: no sentence, Approve stays, Send back still there.
    const can = await renderItem(row, { userId: U.taylor, role: "owner" }, { status: "ok", events: [handoff("q1", U.taylor)] });
    expect(can).toContain("Send back to Rebecca");
    expect(can).not.toContain("send it back.");
    expect(can).not.toContain("data-handed-cant-approve");
    expect(can).toContain(">Approve<");
  });

  it("shows nothing for anyone else, after a send-back, with no events, or when the events could not be read", async () => {
    const plain = await renderItem(row, caitlyn, { status: "ok", events: [] });
    expect(plain).not.toContain("data-handed-to-you");
    expect(plain).not.toContain("Send back");
    expect(await renderItem(row, { userId: U.taylor, role: "owner" }, handed)).not.toContain("data-handed-to-you");
    const back: CardState = { status: "ok", events: [...(handed as { events: never[] }).events, { ...handoff("q1", U.caitlyn), kind: "returned", targetUserId: null, createdAt: "2026-10-28T10:00:00Z" }] };
    expect(await renderItem(row, caitlyn, back)).toBe(plain);
    expect(await renderItem(row, caitlyn, { status: "not-set-up" })).toBe(plain);
    expect(await renderItem(row, caitlyn, { status: "unavailable" })).toBe(plain);
  });

  it("is not offered on a resolved item, and the sent-back banner is a fixed sentence", async () => {
    expect(await renderItem(followup({ id: "q1", status: "approved" }), caitlyn, handed)).not.toContain("data-handed-to-you");
    expect(await renderItem(row, caitlyn, { status: "ok", events: [] }, {}, { returned: "1" })).toContain("Sent back. It&#x27;s on their cards again.");
  });
});
