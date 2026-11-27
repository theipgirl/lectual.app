import { describe, expect, it } from "vitest";
import { isAllowedJoinHost, joinUrlIn, normalizeLawmaticsEvent, parseLawmaticsTime } from "@/lib/lawmatics/events-normalize";

/** Invented names only. The record shape is NOT verified against a live Lawmatics (Blocker 1). */
const ev = (attrs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "e1", type: "event", attributes: { name: "30 Minute Consultation - Wren Tester", ...attrs }, ...extra });

describe("times (17)", () => {
  it("an instant with an offset is kept as UTC", () => {
    const n = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00-05:00", end_time: "2026-11-25T14:30:00-05:00" }));
    expect(n).toMatchObject({ ok: true, event: { startsAt: "2026-11-25T19:00:00.000Z", endsAt: "2026-11-25T19:30:00.000Z", allDay: false } });
  });
  it("no offset is refused: never guessed", () => {
    expect(normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00" }))).toEqual({ ok: false, reason: "no-offset", id: "e1" });
    expect(normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z", end_time: "2026-11-25 14:30" }))).toEqual({ ok: false, reason: "no-offset", id: "e1" });
    expect(parseLawmaticsTime("2026-11-25 14:00").kind).toBe("no-offset");
  });
  it("all-day: UTC midnight of its civil date, all_day true", () => {
    const flagged = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T23:30:00-05:00", all_day: true }));
    expect(flagged).toMatchObject({ ok: true, event: { startsAt: "2026-11-25T00:00:00.000Z", allDay: true } });
    const dateOnly = normalizeLawmaticsEvent(ev({ start_date: "2026-11-26" }));
    expect(dateOnly).toMatchObject({ ok: true, event: { startsAt: "2026-11-26T00:00:00.000Z", allDay: true } });
  });
  it("an end before the start is dropped", () => {
    expect(normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z", end_time: "2026-11-25T13:00:00Z" }))).toEqual({ ok: false, reason: "end-before-start", id: "e1" });
  });
});

describe("stored fields (18) and unusable shapes (21)", () => {
  it("only an https Zoom, Teams or Meet link in the description becomes join_url; the description is never returned", () => {
    const desc = "Join: https://us02web.zoom.us/j/81234567890?pwd=abc. Notes: private client details";
    const n = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z", description: desc, location: "123 Somewhere St" }));
    expect(n.ok && n.event.joinUrl).toBe("https://us02web.zoom.us/j/81234567890?pwd=abc");
    const json = JSON.stringify(n);
    expect(json).not.toContain("private client details");
    expect(json).not.toContain("Somewhere");
    for (const [text, want] of [
      ["see https://teams.microsoft.com/l/meetup-join/abc", "https://teams.microsoft.com/l/meetup-join/abc"],
      ["see https://meet.google.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij"],
      ["http://zoom.us/j/1 (not https)", null],
      ["https://evil.example/zoom.us/j/1", null],
      ["https://zoom.us.evil.example/j/1", null],
      ["https://user:pw@zoom.us/j/1", null],
    ] as const) expect(joinUrlIn(text)).toBe(want);
    expect(isAllowedJoinHost("us06web.zoom.us")).toBe(true);
    expect(isAllowedJoinHost("teams.live.com")).toBe(true);
    expect(isAllowedJoinHost("calendly.com")).toBe(false);
  });
  it("attendee addresses are lowercased and capped at 50 (kept in memory only)", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ email: `Person${i}@Example.TEST` }));
    const n = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z", invitees: many }));
    expect(n.ok && n.event.attendeeEmails).toHaveLength(50);
    expect(n.ok && n.event.attendeeEmails[0]).toBe("person0@example.test");
  });
  it("prospect id, event type and cancelled come from the record", () => {
    const included = new Map([["event_type:9", { id: "9", type: "event_type", attributes: { name: "Complimentary Consultation" } }]]);
    const n = normalizeLawmaticsEvent(
      ev({ start_time: "2026-11-25T14:00:00Z", status: "Cancelled" }, { relationships: { prospect: { data: { type: "prospect", id: "p7" } }, event_type: { data: { type: "event_type", id: "9" } } } }),
      included,
    );
    expect(n).toMatchObject({ ok: true, event: { prospectId: "p7", eventTypeName: "Complimentary Consultation", cancelled: true } });
  });
  it("no id or no start is unusable, never guessed; an id too long for external_id too", () => {
    expect(normalizeLawmaticsEvent({ attributes: { name: "Consult", start_time: "2026-11-25T14:00:00Z" } })).toEqual({ ok: false, reason: "no-id" });
    expect(normalizeLawmaticsEvent(ev({}))).toEqual({ ok: false, reason: "no-start", id: "e1" }); // the id is kept so its row can be held
    expect(normalizeLawmaticsEvent({ id: "x".repeat(250), attributes: { start_time: "2026-11-25T14:00:00Z" } })).toEqual({ ok: false, reason: "id-too-long" });
  });
});

describe("the event's person through relationships.eventable (live shape)", () => {
  const live = (data: Record<string, unknown>) => ev({ start_time: "2026-11-25T14:00:00Z" }, { relationships: { eventable: { data } } });

  it("a prospect eventable (id only, no name) is the prospect id, whatever the type's spelling", () => {
    for (const type of ["prospect", "Prospect", "prospects", "matter", "Matters"]) {
      const n = normalizeLawmaticsEvent(live({ type, id: "4417" }));
      expect(n.ok && n.event.prospectId).toBe("4417");
    }
  });

  it("the older relationships and the flat ids still win in their order", () => {
    const n = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z" }, { relationships: { prospect: { data: { type: "prospect", id: "p1" } }, eventable: { data: { type: "prospect", id: "p2" } } } }));
    expect(n.ok && n.event.prospectId).toBe("p1");
    const flat = normalizeLawmaticsEvent(ev({ start_time: "2026-11-25T14:00:00Z", prospect_id: "p3" }));
    expect(flat.ok && flat.event.prospectId).toBe("p3");
  });

  it("a contact eventable is not a prospect id; its email comes from the sideload, else the run's contacts", () => {
    const rec = live({ type: "contact", id: "c9" });
    const bare = normalizeLawmaticsEvent(rec);
    expect(bare.ok && bare.event.prospectId).toBeNull();
    expect(bare.ok && bare.event.attendeeEmails).toEqual([]);
    const side = normalizeLawmaticsEvent(rec, new Map([["contacts:c9", { id: "c9", type: "contacts", attributes: { email: "Ola@Example.test" } }]]));
    expect(side.ok && side.event.attendeeEmails).toEqual(["ola@example.test"]);
    const fromRun = normalizeLawmaticsEvent(rec, new Map(), new Map([["c9", { email: "ola@example.test" }]]));
    expect(fromRun.ok && fromRun.event.attendeeEmails).toEqual(["ola@example.test"]);
    const other = normalizeLawmaticsEvent(rec, new Map(), new Map([["c8", { email: "x@example.test" }]]));
    expect(other.ok && other.event.attendeeEmails).toEqual([]);
  });

  it("an eventable of another type, or with no id, links nothing", () => {
    for (const data of [{ type: "user", id: "u1" }, { type: "prospect" }, { id: "4417" }]) {
      const n = normalizeLawmaticsEvent(live(data));
      expect(n.ok && n.event.prospectId).toBeNull();
      expect(n.ok && n.event.attendeeEmails).toEqual([]);
    }
  });
});
