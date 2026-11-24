import { describe, expect, it } from "vitest";
import { isConsultTitle } from "@/lib/calendar/outlook-parse";
import {
  CONSULT_REMOVE_CAP,
  CONSULT_WRITE_CAP,
  isLawmaticsConsult,
  lmsyncExternalId,
  planConsults,
  type ConsultLead,
  type OwnConsultRow,
} from "@/lib/lawmatics/consult-sync-plan";
import type { LawmaticsEvent } from "@/lib/lawmatics/events-normalize";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

const event = (id: string, over: Partial<LawmaticsEvent> = {}): LawmaticsEvent => ({
  id,
  title: "30 Minute Consultation - Wren Tester",
  startsAt: day(2),
  endsAt: day(2.02),
  allDay: false,
  eventTypeName: null,
  cancelled: false,
  prospectId: null,
  joinUrl: null,
  attendeeEmails: [],
  ...over,
});
const lead = (id: string, over: Partial<ConsultLead> = {}): ConsultLead => ({ id, email: `${id}@example.test`, lawmatics_id: null, merged_into_id: null, ...over });
const own = (eventId: string, over: Partial<OwnConsultRow> = {}): OwnConsultRow => ({
  id: `row-${eventId}`,
  external_id: lmsyncExternalId(eventId),
  title: "30 Minute Consultation - Wren Tester",
  starts_at: day(2),
  ends_at: day(2.02),
  all_day: false,
  event_type: null,
  lead_id: null,
  matter_id: null,
  join_url: null,
  is_consult: true,
  ...over,
});
const plan = (input: Partial<Parameters<typeof planConsults>[0]>) =>
  planConsults({ events: [], leads: [], matters: [], ownRows: [], nowMs: NOW, complete: true, ...input });

/** A copy of lawmatics-mcp's isConsult (src/consult.ts, lines 77-86, as sent by the director on Nov 23). */
function mcpIsConsult(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  return t.includes("strategy session") || t.includes("discovery call") || t.includes("consult") || t.includes("initial call");
}

describe("consult matching (13)", () => {
  const TITLES = [
    "30 Minute Consultation - Wren Tester",
    "Complimentary Consultation",
    "Topic: Discovery Call with Staff Person - Wren Tester",
    "Strategy Session",
    "Initial call",
    "INITIAL CALL with Ola",
    "Court hearing",
    "Internal meeting",
    "Consulting fee review",
    "",
  ];
  it("isConsultTitle agrees with a copy of lawmatics-mcp's isConsult on the whole table", () => {
    for (const t of TITLES) expect(isConsultTitle(t), t).toBe(mcpIsConsult(t));
  });
  it("by title, by event type, and not a court hearing", () => {
    expect(isLawmaticsConsult({ title: "30 Minute Consultation - X", eventTypeName: null })).toBe(true);
    expect(isLawmaticsConsult({ title: "Wren Tester", eventTypeName: "Complimentary Consultation" })).toBe(true);
    expect(isLawmaticsConsult({ title: "Topic: Discovery Call with Y - X", eventTypeName: null })).toBe(true);
    expect(isLawmaticsConsult({ title: "Strategy Session", eventTypeName: null })).toBe(true);
    expect(isLawmaticsConsult({ title: "Initial call", eventTypeName: null })).toBe(true);
    expect(isLawmaticsConsult({ title: "Court hearing", eventTypeName: "Court" })).toBe(false);
    const p = plan({ events: [event("1"), event("2", { title: "Court hearing" })] });
    expect(p.writes.map((w) => w.lawmatics_id)).toEqual(["1"]);
    expect(p.counts.notConsult).toBe(1);
  });
});

describe("lead links (14, 15, 16)", () => {
  it("the prospect id first; else exactly one lead by attendee email; two or none: the next rule", () => {
    const leads = [lead("byId", { lawmatics_id: "p1" }), lead("byMail", { email: "ola@example.test" }), lead("twinA", { email: "dup@example.test" }), lead("twinB", { email: "dup@example.test" })];
    const p = plan({
      leads,
      events: [
        event("a", { prospectId: "p1", attendeeEmails: ["ola@example.test"] }),
        event("b", { attendeeEmails: ["ola@example.test"] }),
        event("c", { attendeeEmails: ["dup@example.test"] }),
        event("d", {}),
      ],
    });
    expect(Object.fromEntries(p.writes.map((w) => [w.lawmatics_id, w.lead_id]))).toEqual({ a: "byId", b: "byMail", c: null, d: null });
  });
  it("a merged lead is followed to its keeper", () => {
    const p = plan({ leads: [lead("K"), lead("M", { lawmatics_id: "p1", merged_into_id: "K" })], events: [event("a", { prospectId: "p1" })] });
    expect(p.writes[0].lead_id).toBe("K");
  });
  it("a prospect id no lead holds asks for a targeted read; a lead made since then is linked on the second plan", () => {
    const first = plan({ events: [event("a", { prospectId: "p9" })] });
    expect(first.needProspects).toEqual(["p9"]);
    expect(first.writes[0].lead_id).toBeNull();
    const second = plan({ events: [event("a", { prospectId: "p9" })], leads: [lead("new", { lawmatics_id: "p9" })] });
    expect(second.needProspects).toEqual([]);
    expect(second.writes[0].lead_id).toBe("new");
  });
  it("a Lost lead is linked like any other (the plan has no stage field)", () => {
    const p = plan({ leads: [lead("lost", { email: "ola@example.test" })], events: [event("a", { attendeeEmails: ["ola@example.test"] })] });
    expect(p.writes[0].lead_id).toBe("lost");
    expect(JSON.stringify(p.writes[0])).not.toMatch(/stage/);
  });
  it("a matter is linked only when exactly one matter has the prospect id", () => {
    const one = plan({ matters: [{ id: "m1", lawmatics_id: "p1" }], events: [event("a", { prospectId: "p1" })] });
    expect(one.writes[0].matter_id).toBe("m1");
    const two = plan({ matters: [{ id: "m1", lawmatics_id: "p1" }, { id: "m2", lawmatics_id: "p1" }], events: [event("a", { prospectId: "p1" })] });
    expect(two.writes[0].matter_id).toBeNull();
  });
});

describe("stored fields (18)", () => {
  it("location, attendee_emails, organizer_email and contact_name are null; external_id is lmsync:<id>", () => {
    const p = plan({ events: [event("a", { joinUrl: "https://zoom.us/j/1", attendeeEmails: ["ola@example.test"], eventTypeName: "Complimentary Consultation" })] });
    expect(p.writes[0]).toMatchObject({
      source: "lawmatics",
      external_id: "lmsync:a",
      lawmatics_id: "a",
      is_consult: true,
      location: null,
      attendee_emails: null,
      organizer_email: null,
      contact_name: null,
      join_url: "https://zoom.us/j/1",
      event_type: "Complimentary Consultation",
    });
    expect(JSON.stringify(p.writes)).not.toContain("ola@example.test");
  });
});

describe("reschedule, cancel, complete reads (19, 20)", () => {
  it("rescheduled: one write with the new times; unchanged: no write at all (idempotent)", () => {
    const moved = plan({ events: [event("a", { startsAt: day(3), endsAt: day(3.02) })], ownRows: [own("a")] });
    expect(moved.writes).toHaveLength(1);
    expect(moved.writes[0].starts_at).toBe(day(3));
    const same = plan({ events: [event("a")], ownRows: [own("a")] });
    expect(same.writes).toHaveLength(0);
    expect(same.removeIds).toHaveLength(0);
    expect(same.counts.unchanged).toBe(1);
  });
  it("cancelled: removed (complete read)", () => {
    const p = plan({ events: [event("a", { cancelled: true })], ownRows: [own("a")] });
    expect(p.writes).toHaveLength(0);
    expect(p.removeIds).toEqual(["row-a"]);
  });
  it("a row in the window missing from the read is removed; outside the window kept; a legacy or Outlook row never touched", () => {
    const p = plan({
      events: [],
      recordsRead: 5, // the read returned other (non-window) records, so it is not an empty read
      ownRows: [
        own("gone"),
        own("old", { starts_at: day(-30) }),
        { ...own("legacy"), external_id: "12345" },
        { ...own("outlook"), external_id: "AAMkAG..." },
      ],
    });
    expect(p.removeIds).toEqual(["row-gone"]);
  });
  it("an incomplete read removes nothing", () => {
    expect(plan({ complete: false, ownRows: [own("gone")] }).removeIds).toEqual([]);
  });
  it("a non-consult event whose own row exists is removed like a vanished one", () => {
    const p = plan({ events: [event("a", { title: "Internal meeting" })], ownRows: [own("a")] });
    expect(p.removeIds).toEqual(["row-a"]);
  });
  it("an event outside the window (now - 7 to now + 60 days) is ignored", () => {
    const p = plan({ events: [event("a", { startsAt: day(-8) }), event("b", { startsAt: day(61) })] });
    expect(p.writes).toHaveLength(0);
    expect(p.counts.outsideWindow).toBe(2);
  });
  it(`caps: ${CONSULT_WRITE_CAP} writes and ${CONSULT_REMOVE_CAP} removals per run`, () => {
    const many = plan({ events: Array.from({ length: 520 }, (_, i) => event(String(i))) });
    expect(many.writes).toHaveLength(500);
    expect(many.counts.overWriteCap).toBe(20);
    // Positive removals (read as cancelled), so neither vanish guard applies.
    const gone = plan({ events: Array.from({ length: 210 }, (_, i) => event(`g${i}`, { cancelled: true })), ownRows: Array.from({ length: 210 }, (_, i) => own(`g${i}`)) });
    expect(gone.removeIds).toHaveLength(200);
    expect(gone.counts.overRemoveCap).toBe(10);
  });
});

describe("removal guards (evaluation round 2)", () => {
  it("an unreadable record with an id holds only its own row; a cancelled consult is still removed", () => {
    const p = plan({ complete: true, heldIds: ["bad"], events: [event("c", { cancelled: true })], ownRows: [own("bad"), own("c")], recordsRead: 2 });
    expect(p.removeIds).toEqual(["row-c"]);
    expect(p.removalHold).toBeNull();
  });
  it("an incomplete read (a record with no id, cut short) holds vanished rows but still removes rows read as cancelled, not a consult or out of the window", () => {
    const p = plan({
      complete: false,
      events: [event("c", { cancelled: true }), event("n", { title: "Internal meeting" }), event("o", { startsAt: day(70) }), event("k")],
      ownRows: [own("c"), own("n"), own("o"), own("vanished"), own("k")],
      recordsRead: 5,
    });
    expect(p.removeIds.sort()).toEqual(["row-c", "row-n", "row-o"]);
    expect(p.removalHold).toBe("incomplete");
  });
  it("a read with no records while stored rows exist removes nothing and says why", () => {
    const p = plan({ events: [], recordsRead: 0, ownRows: [own("a"), own("b")] });
    expect(p.removeIds).toEqual([]);
    expect(p.removalHold).toBe("empty-read");
  });
  it("more than half of the stored rows vanishing at once is held; a single vanished consult still goes", () => {
    const many = plan({ events: [event("k")], recordsRead: 1, ownRows: [own("k"), own("v1"), own("v2"), own("v3")] });
    expect(many.removeIds).toEqual([]);
    expect(many.removalHold).toBe("too-many-vanished");
    const one = plan({ events: [event("k")], recordsRead: 1, ownRows: [own("k"), own("v1")] });
    expect(one.removeIds).toEqual(["row-v1"]);
    const fewOfMany = plan({ events: [event("a"), event("b"), event("c")], recordsRead: 3, ownRows: [own("a"), own("b"), own("c"), own("v1"), own("v2")] });
    expect(fewOfMany.removeIds.sort()).toEqual(["row-v1", "row-v2"]);
  });
});
