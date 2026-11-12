import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { QueueItem } from "@/lib/queue/api";
import type { CardEvent } from "@/lib/queue/deck";
import {
  decidableIds,
  decidedRows,
  decidedSource,
  eventSources,
  handedRows,
  laterBackPill,
  laterRows,
  makeListFormat,
  parseListParam,
  sourceCount,
  stripReceipt,
} from "@/lib/queue/deck-lists";

const TZ = "America/New_York";
const NOW = new Date("2026-11-10T14:30:00Z"); // 9:30 AM Nov 10 in New York
const fmt = makeListFormat(NOW, TZ);
const ME = "00000000-0000-4000-8000-0000000000a1";
const CAIT = "00000000-0000-4000-8000-0000000000a2";
const OWEN = "00000000-0000-4000-8000-0000000000a3";
const DEC = new Set(["p1", "p2", "l1", "l2"]);
const names: Record<string, string> = { [CAIT]: "Caitlyn", [OWEN]: "Owen" };
const first = (id: string) => names[id] ?? "a teammate";

function item(over: Partial<QueueItem> & { id: string }): QueueItem {
  return {
    org_id: "o",
    matter_id: null,
    agent: "post-consult",
    type: "CLIENT_EMAIL",
    headline: `Headline ${over.id}`,
    summary: null,
    draft_body: "",
    final_body: null,
    status: "pending",
    created_at: "2026-11-10T10:00:00Z",
    client_name: null,
    recipient: null,
    subject: null,
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}
const ev = (e: Partial<CardEvent> & Pick<CardEvent, "queueItemId" | "kind" | "createdAt">): CardEvent => ({ actorId: ME, targetUserId: null, until: null, note: null, ...e });

describe("decided today", () => {
  const mine = "rebecca@rpb.example";
  const approvedAt = "2026-11-10T12:12:00Z"; // 7:12 AM
  it("separates approved from rejected and says client email, with no Outlook claim", () => {
    const rows = decidedRows(
      [
        item({ id: "a", status: "approved", resolved_by: mine, resolved_at: approvedAt }),
        item({ id: "r", status: "rejected", resolved_by: mine, resolved_at: "2026-11-10T12:20:00Z", resolution_note: "Answers an older email." }),
      ],
      mine,
      fmt,
    );
    expect(rows.map((r) => [r.id, r.pill])).toEqual([
      ["r", "Rejected"],
      ["a", "Approved"],
    ]);
    expect(rows.find((r) => r.id === "a")?.sub).toBe("Approved 7:12 AM · client email");
    expect(rows.find((r) => r.id === "r")?.sub).toBe("Rejected 7:20 AM · “Answers an older email.”");
  });
  it("an internal briefing says internal, and a non-email approval says nothing extra", () => {
    const rows = decidedRows(
      [
        item({ id: "b", type: "BRIEFING", agent: "morning-brief", headline: "Morning brief for Monday", status: "approved", resolved_by: mine, resolved_at: approvedAt }),
        item({ id: "l", type: "ENGAGEMENT_LETTER", agent: "document-center", status: "approved", resolved_by: mine, resolved_at: approvedAt }),
      ],
      mine,
      fmt,
    );
    expect(rows.find((r) => r.id === "b")?.sub).toMatch(/internal$/);
    expect(rows.find((r) => r.id === "l")?.sub).toBe("Approved 7:12 AM");
  });
  it("leaves out another day and another person", () => {
    const rows = decidedRows(
      [
        item({ id: "old", status: "approved", resolved_by: mine, resolved_at: "2026-11-09T12:00:00Z" }),
        item({ id: "other", status: "approved", resolved_by: "dana@rpb.example", resolved_at: approvedAt }),
        item({ id: "ok", status: "approved", resolved_by: "REBECCA@rpb.example", resolved_at: approvedAt }),
      ],
      mine,
      fmt,
    );
    expect(rows.map((r) => r.id)).toEqual(["ok"]);
    expect(decidedRows([item({ id: "x", status: "approved", resolved_by: mine, resolved_at: approvedAt })], null, fmt)).toEqual([]);
  });
  it("never shows the receipt hash, in an approval or a rejection note", () => {
    expect(stripReceipt("Looks right.\nReceipt: sha256 0123456789ab")).toBe("Looks right.");
    expect(stripReceipt("Receipt: sha256 0123456789ab")).toBe("");
    const rows = decidedRows(
      [
        item({ id: "a", status: "approved", resolved_by: mine, resolved_at: approvedAt, resolution_note: "Receipt: sha256 0123456789ab" }),
        item({ id: "r", status: "rejected", resolved_by: mine, resolved_at: approvedAt, resolution_note: "Wrong package.\nReceipt: sha256 fedcba987654" }),
      ],
      mine,
      fmt,
    );
    for (const r of rows) expect(r.sub).not.toMatch(/sha256|Receipt|[0-9a-f]{12}/);
    expect(rows.find((r) => r.id === "r")?.sub).toBe("Rejected 7:12 AM · “Wrong package.”");
  });
  it("builds no link to Outlook", () => {
    const [row] = decidedRows([item({ id: "a", status: "approved", resolved_by: mine, resolved_at: approvedAt, resolution_note: "https://outlook.example/draft" })], mine, fmt);
    expect(Object.values(row).join(" ")).not.toMatch(/outlook\.example|https?:/);
    expect(row.sub).not.toMatch(/Outlook|draft/i);
    expect(row.href).toBe("/dashboard/queue/a/");
  });
  it("a failed approved or rejected read is unavailable, never an empty list", () => {
    const ok = { status: "ok", items: [] as QueueItem[] };
    expect(decidedSource({ status: "unavailable" }, ok, "a@b.c", fmt)).toEqual({ status: "unavailable" });
    expect(decidedSource(ok, { status: "unreachable" }, "a@b.c", fmt)).toEqual({ status: "unavailable" });
    expect(decidedSource(ok, ok, "a@b.c", fmt)).toEqual({ status: "ok", rows: [] });
  });
});

describe("handed off", () => {
  const pend = [item({ id: "p1", headline: "Priya engagement letter" }), item({ id: "p2", headline: "Owen filing receipt" })];
  it("still with the colleague reads With <name>, with the note quoted", () => {
    const rows = handedRows(pend, [ev({ queueItemId: "p1", kind: "handoff", targetUserId: CAIT, note: "Check the class descriptions", createdAt: "2026-11-10T12:24:00Z" })], ME, first, fmt, DEC);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pill: "With Caitlyn", back: false, sub: "To Caitlyn 7:24 AM · “Check the class descriptions”" });
  });
  it("hand-off, then returned reads Back with you with the day and the time it came back", () => {
    const rows = handedRows(
      pend,
      [
        ev({ queueItemId: "p2", kind: "handoff", targetUserId: OWEN, createdAt: "2026-11-07T15:00:00Z" }),
        ev({ queueItemId: "p2", kind: "returned", actorId: OWEN, createdAt: "2026-11-10T14:02:00Z" }),
      ],
      ME,
      first,
      fmt,
      DEC,
    );
    expect(rows[0]).toMatchObject({ id: "p2", pill: "Back with you", back: true, sub: "To Owen Nov 7 · sent back 9:02 AM" });
  });
  it("a hand-off by someone else, or one on a decided item, is not on this list", () => {
    const rows = handedRows(
      [...pend, item({ id: "done", status: "approved" })],
      [
        ev({ queueItemId: "p1", kind: "handoff", actorId: CAIT, targetUserId: OWEN, createdAt: "2026-11-10T12:00:00Z" }),
        ev({ queueItemId: "done", kind: "handoff", targetUserId: CAIT, createdAt: "2026-11-10T12:00:00Z" }),
      ],
      ME,
      first,
      fmt,
      DEC,
    );
    expect(rows).toEqual([]);
  });
  it("a hand-off with no note has no quote and the receipt never shows in a note", () => {
    const [row] = handedRows(pend, [ev({ queueItemId: "p1", kind: "handoff", targetUserId: CAIT, note: "Receipt: sha256 0123456789ab", createdAt: "2026-11-10T12:24:00Z" })], ME, first, fmt, DEC);
    expect(row.sub).toBe("To Caitlyn 7:24 AM");
  });
});

describe("later", () => {
  const pend = [item({ id: "l1", headline: "Welcome Jordan Park" }), item({ id: "l2" })];
  const back = (until: string) => laterBackPill(until, NOW, TZ);
  it("lists a Later still in force with just its time; an expired one is not listed", () => {
    const rows = laterRows(
      pend,
      [
        ev({ queueItemId: "l1", kind: "later", until: "2026-11-10T19:00:00Z", createdAt: "2026-11-10T13:00:00Z" }), // 2:00 PM today
        ev({ queueItemId: "l2", kind: "later", until: "2026-11-10T12:00:00Z", createdAt: "2026-11-10T08:00:00Z" }), // 7:00 AM, passed
      ],
      ME,
      NOW,
      DEC,
      () => "Welcome drafter · client email",
      back,
    );
    expect(rows.map((r) => r.id)).toEqual(["l1"]);
    expect(rows[0].pill).toBe("2:00 PM");
  });
  it("pill format: bare time today, Tomorrow + time the next day, date + time after that", () => {
    expect(back("2026-11-10T19:00:00Z")).toBe("2:00 PM");
    expect(back("2026-11-11T12:00:00Z")).toBe("Tomorrow 7:00 AM");
    expect(back("2026-11-14T12:00:00Z")).toBe("Nov 14 7:00 AM");
  });
  it("only the viewer's own Later counts", () => {
    expect(laterRows(pend, [ev({ queueItemId: "l1", kind: "later", actorId: CAIT, until: "2026-11-10T19:00:00Z", createdAt: "2026-11-10T13:00:00Z" })], ME, NOW, DEC, () => "", back)).toEqual([]);
  });
});

describe("a failed source is never empty", () => {
  const noRows = { handed: () => [], later: () => [] };
  it("pending unreadable, events unreadable and events not set up are each their own state", () => {
    expect(eventSources({ pendingStatus: "unavailable", cardState: null, ...noRows })).toEqual({ handed: { status: "unavailable" }, later: { status: "unavailable" } });
    expect(eventSources({ pendingStatus: "ok", cardState: { status: "unavailable" }, ...noRows }).handed).toEqual({ status: "unavailable" });
    expect(eventSources({ pendingStatus: "ok", cardState: { status: "not-set-up" }, ...noRows }).later).toEqual({ status: "not-set-up" });
    expect(eventSources({ pendingStatus: "ok", cardState: { status: "ok", events: [] }, ...noRows }).handed).toEqual({ status: "ok", rows: [] });
  });
  it("an unconfigured queue is its own not-connected state, for the events and the resolved lists", () => {
    expect(eventSources({ pendingStatus: "unconfigured", cardState: null, ...noRows })).toEqual({ handed: { status: "not-connected" }, later: { status: "not-connected" } });
    const ok = { status: "ok", items: [] as QueueItem[] };
    expect(decidedSource({ status: "unconfigured" }, ok, "a@b.c", fmt)).toEqual({ status: "not-connected" });
  });
  it("chip counts are a dash for anything but ok, never 0", () => {
    expect(sourceCount({ status: "unavailable" })).toBe("—");
    expect(sourceCount({ status: "not-set-up" })).toBe("—");
    expect(sourceCount({ status: "ok", rows: [] })).toBe("0");
  });
});

describe("the list parameter", () => {
  it("accepts only the four lists", () => {
    expect(["decided", "handed", "later", "need"].map(parseListParam)).toEqual(["decided", "handed", "later", "need"]);
    expect(parseListParam("x")).toBeNull();
    expect(parseListParam(undefined)).toBeNull();
    expect(parseListParam(["later", "x"])).toBe("later");
  });
  it("the page branch sits behind the deck's own gate", () => {
    const src = readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8");
    expect(src.indexOf('orgHasModule("role-views")')).toBeGreaterThan(-1);
    expect(src.indexOf("DeckListsView({ list })")).toBeGreaterThan(src.indexOf('orgHasModule("role-views")'));
  });
});

describe("an approved client email never claims a draft exists", () => {
  it("whatever the note or agent says", () => {
    const rows = decidedRows(
      [
        item({ id: "a", status: "approved", resolved_by: "me@x.y", resolved_at: "2026-11-10T12:12:00Z", resolution_note: "Draft is in Outlook" }),
        item({ id: "b", type: "CLIENT_EMAIL", agent: "welcome", status: "approved", resolved_by: "me@x.y", resolved_at: "2026-11-10T12:13:00Z" }),
      ],
      "me@x.y",
      fmt,
    );
    for (const r of rows) expect(r.sub).not.toMatch(/outlook|draft/i);
  });
});

describe("later matches the deck's own count", () => {
  const back = (u: string) => laterBackPill(u, NOW, TZ);
  const lat = ev({ queueItemId: "l1", kind: "later", until: "2026-11-10T19:00:00Z", createdAt: "2026-11-10T13:00:00Z" });
  it("a card handed TO the viewer and then put on Later is listed", () => {
    const rows = laterRows([item({ id: "l1" })], [ev({ queueItemId: "l1", kind: "handoff", actorId: CAIT, targetUserId: ME, createdAt: "2026-11-10T12:00:00Z" }), lat], ME, NOW, new Set(), () => "", back);
    expect(rows.map((r) => r.id)).toEqual(["l1"]);
  });
  it("a card now with a colleague is not listed", () => {
    expect(laterRows([item({ id: "l1" })], [lat, ev({ queueItemId: "l1", kind: "handoff", targetUserId: CAIT, createdAt: "2026-11-10T13:30:00Z" })], ME, NOW, DEC, () => "", back)).toEqual([]);
  });
  it("a card the viewer may not decide is not listed", () => {
    expect(laterRows([item({ id: "l1" })], [lat], ME, NOW, new Set(), () => "", back)).toEqual([]);
  });
  it("decidableIds is the deck's filter: pending, mine and approvable", () => {
    const owner = { userId: ME, role: "owner" as const };
    expect([...decidableIds([item({ id: "a" }), item({ id: "b", status: "approved" })], {}, owner)]).toEqual(["a"]);
  });
});

describe("Back with you after a re-hand-off", () => {
  it("is not shown when the item is no longer the viewer's to decide", () => {
    const events = [
      ev({ queueItemId: "p2", kind: "handoff", targetUserId: OWEN, createdAt: "2026-11-07T15:00:00Z" }),
      ev({ queueItemId: "p2", kind: "returned", actorId: OWEN, createdAt: "2026-11-10T14:02:00Z" }),
    ];
    const pend = [item({ id: "p2" })];
    expect(handedRows(pend, events, ME, first, fmt, new Set(["p2"]))).toHaveLength(1);
    expect(handedRows(pend, events, ME, first, fmt, new Set())).toEqual([]);
  });
});
