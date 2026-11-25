import { describe, expect, it } from "vitest";
import { ADOPT_AGENTS, adoptableItems, adoptionSinceMs, isFullBrief, itemText, pickAdoption, startOfFirmDayMs, stillAdoptable } from "@/lib/consult-prep/adopt";
import { NEXT_UPDATE_LINE, renderConsultBrief } from "@/lib/consult-prep/brief";
import type { QueueItem } from "@/lib/queue/api";

const FULL = "Consult prep for Dana Ruiz\n\nLikely classes\nClass 25, Class 35\n\nRisk read\nOne close mark\n\nPackage recommendation\nEnhanced\n";
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1",
  org_id: "org",
  matter_id: null,
  agent: "prep-consult",
  type: "BRIEFING",
  headline: "Prep",
  summary: null,
  draft_body: FULL,
  final_body: null,
  status: "pending",
  created_at: "2026-11-25T14:00:00.000Z",
  client_name: "Dana Ruiz",
  recipient: null,
  subject: null,
  proposed_send_at: null,
  attachments: null,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  ...over,
});

describe("isFullBrief: the class, risk and package sections", () => {
  it("is true when all three headings are there, in any case and with markdown or numbering around them", () => {
    expect(isFullBrief(FULL)).toBe(true);
    expect(isFullBrief("## LIKELY CLASSES\nx\n**Preliminary risk**\ny\n3) package recommendation: Enhanced")).toBe(true);
    expect(isFullBrief("Likely classes\nRisk read\nPackage recommendation")).toBe(true);
  });
  it("a heads-up or a facts-only brief is not full", () => {
    expect(isFullBrief("Heads-up\nSession tomorrow 2 PM\nClient: Dana Ruiz")).toBe(false);
    expect(isFullBrief("Likely classes\nClass 25\nRisk read\nlow")).toBe(false); // no package section
    expect(isFullBrief("Risk read\nlow\nPackage recommendation\nEnhanced")).toBe(false); // no classes section
    expect(isFullBrief("Likely classes\nx\nPackage recommendation\ny")).toBe(false); // no risk section
    expect(isFullBrief("")).toBe(false);
  });
  it("a sentence that merely mentions a heading is not the section", () => {
    const sentence = "We will cover the likely classes, the risk read and the package recommendation in the next meeting and write them up in full detail afterwards.";
    expect(isFullBrief(sentence)).toBe(false);
  });
  it("Lectual's own S1 facts brief is never full, even if its wording is close", () => {
    const facts = renderConsultBrief({
      lead: { id: "l1", firstName: "Dana", lastName: "Ruiz", businessName: null, email: null, phone: null, practiceArea: null, markText: null, referralSource: null, referralDetail: null, stage: null, lawmaticsId: null },
      startsAt: null,
      joinUrl: null,
      preparedAt: "2026-11-25T14:00:00.000Z",
      tz: "America/New_York",
      lawmatics: { state: "not-linked" },
      answers: { state: "ok", blocks: [] },
      files: { state: "ok", files: [], more: 0 },
      mail: { state: "ok", summary: { received: 0, sent: 0, newestReceived: null, subjects: [], withheld: 0 } },
      meetings: { state: "ok", meetings: [] },
    }).text;
    expect(facts).toContain(NEXT_UPDATE_LINE);
    expect(isFullBrief(facts)).toBe(false);
    expect(isFullBrief(`${FULL}\n${NEXT_UPDATE_LINE}`)).toBe(false);
  });
});

describe("adoptableItems: type, agent, status, age, fullness", () => {
  const since = Date.parse("2026-11-25T05:00:00.000Z");
  it("keeps a recent full BRIEFING from either agent, pending or approved", () => {
    const keep = [item({ id: "a" }), item({ id: "b", agent: "consult-prep" }), item({ id: "c", status: "approved" })];
    expect(adoptableItems(keep, since).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(ADOPT_AGENTS).toEqual(["prep-consult", "consult-prep"]);
  });
  it("drops a heads-up, another agent, another type, a rejected item and an old one", () => {
    const drop = [
      item({ id: "headsup", draft_body: "Heads-up: session at 2" }),
      item({ id: "agent", agent: "post-consult" }),
      item({ id: "type", type: "CLIENT_EMAIL" }),
      item({ id: "rejected", status: "rejected" }),
      item({ id: "old", created_at: "2026-11-24T12:00:00.000Z" }),
      item({ id: "baddate", created_at: "not a date" }),
    ];
    expect(adoptableItems(drop, since)).toEqual([]);
  });
  it("reads an approver's edit (final_body) before the draft", () => {
    expect(itemText(item({ final_body: "edited", draft_body: "draft" }))).toBe("edited");
    expect(itemText(item({ final_body: "  ", draft_body: "draft" }))).toBe("draft");
    expect(adoptableItems([item({ draft_body: "no sections", final_body: FULL })], since)).toHaveLength(1);
  });
});

describe("pickAdoption: exactly one lead, the newest", () => {
  const a = item({ id: "a", created_at: "2026-11-25T10:00:00.000Z" });
  const b = item({ id: "b", created_at: "2026-11-25T12:00:00.000Z" });
  it("takes the newest item linked to this one lead", () => {
    expect(pickAdoption([a, b], new Map([["a", { leadIds: ["L"] }], ["b", { leadIds: ["L"] }]]), "L")?.id).toBe("b");
  });
  it("ignores an item linked to another lead, to two leads, or to none", () => {
    expect(pickAdoption([a, b], new Map([["a", { leadIds: ["other"] }], ["b", { leadIds: ["L", "other"] }]]), "L")).toBeNull();
    expect(pickAdoption([a], new Map(), "L")).toBeNull();
    expect(pickAdoption([a], new Map([["a", { leadIds: [] }]]), "L")).toBeNull();
  });
});

describe("stillAdoptable: a prep that adopted an item earlier", () => {
  it("the item, while it is still pending or approved and full", () => {
    expect(stillAdoptable([item()], "q1")?.id).toBe("q1");
    expect(stillAdoptable([item({ status: "approved" })], "q1")?.id).toBe("q1");
  });
  it("not once it is gone, rejected, edited into a heads-up or from another agent", () => {
    expect(stillAdoptable([], "q1")).toBeNull();
    expect(stillAdoptable([item({ status: "rejected" })], "q1")).toBeNull();
    expect(stillAdoptable([item({ final_body: "just a note" })], "q1")).toBeNull();
    expect(stillAdoptable([item({ agent: "x" })], "q1")).toBeNull();
    expect(stillAdoptable([item()], "other")).toBeNull();
  });
});

describe("the window: since the booking, or the firm's day, whichever is earlier", () => {
  const now = Date.parse("2026-11-25T18:30:00.000Z"); // 1:30 PM in New York
  it("the start of the firm's day, across a DST change too", () => {
    expect(new Date(startOfFirmDayMs(now, "America/New_York")).toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(new Date(startOfFirmDayMs(Date.parse("2026-07-10T18:30:00Z"), "America/New_York")).toISOString()).toBe("2026-07-10T04:00:00.000Z");
    expect(new Date(startOfFirmDayMs(Date.parse("2026-11-01T18:00:00Z"), "America/New_York")).toISOString()).toBe("2026-11-01T04:00:00.000Z"); // the day clocks go back
    expect(new Date(startOfFirmDayMs(Date.parse("2026-03-08T18:00:00Z"), "America/New_York")).toISOString()).toBe("2026-03-08T05:00:00.000Z"); // the day they go forward
  });
  it("booked before today: since the booking; booked today: since the start of today; no booking known: today", () => {
    expect(new Date(adoptionSinceMs("2026-11-20T09:00:00.000Z", now, "America/New_York")).toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(new Date(adoptionSinceMs("2026-11-25T15:00:00.000Z", now, "America/New_York")).toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(new Date(adoptionSinceMs(null, now, "America/New_York")).toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(new Date(adoptionSinceMs("garbage", now, "America/New_York")).toISOString()).toBe("2026-11-25T05:00:00.000Z");
  });
});
