import { describe, expect, it } from "vitest";
import {
  buildLeadIndex,
  extractJoinUrl,
  graphInstant,
  isConsult,
  isConsultTitle,
  linkLead,
  normaliseAttendees,
  normaliseGraphEvent,
  type GraphEvent,
} from "@/lib/calendar/outlook-parse";

const FIRM = new Set(["rebecca@firm.example", "intake@firm.example"]);

describe("join URL", () => {
  it("prefers an https onlineMeeting.joinUrl over anything in the text", () => {
    expect(
      extractJoinUrl({
        onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
        location: { displayName: "https://zoom.us/j/111" },
        bodyPreview: "https://zoom.us/j/222",
      }),
    ).toBe("https://teams.microsoft.com/l/meetup-join/abc");
  });

  it("takes the first https Zoom or Teams link from the location, then from the preview", () => {
    expect(extractJoinUrl({ location: { displayName: "Join: https://us02web.zoom.us/j/12345?pwd=x." } })).toBe(
      "https://us02web.zoom.us/j/12345?pwd=x",
    );
    expect(extractJoinUrl({ location: { displayName: "Conference room" }, bodyPreview: "Dial in at https://teams.microsoft.com/l/meetup-join/zzz, see you" })).toBe(
      "https://teams.microsoft.com/l/meetup-join/zzz",
    );
    // Location wins over the preview.
    expect(
      extractJoinUrl({ location: { displayName: "https://zoom.us/j/1" }, bodyPreview: "https://teams.microsoft.com/l/meetup-join/2" }),
    ).toBe("https://zoom.us/j/1");
  });

  it("is null when there is no link at all", () => {
    expect(extractJoinUrl({})).toBeNull();
    expect(extractJoinUrl({ location: { displayName: "Her office" }, bodyPreview: "Looking forward to it" })).toBeNull();
    expect(extractJoinUrl({ onlineMeeting: { joinUrl: null } })).toBeNull();
  });

  it("never returns a non-https or other-host URL found in the text", () => {
    expect(extractJoinUrl({ location: { displayName: "http://zoom.us/j/1" } })).toBeNull();
    expect(extractJoinUrl({ bodyPreview: "https://evil.example/zoom.us/j/1" })).toBeNull();
    expect(extractJoinUrl({ bodyPreview: "https://notzoom.us/j/1 and https://zoom.us.evil.example/j/2" })).toBeNull();
    expect(extractJoinUrl({ bodyPreview: "see https://meet.example.com/room" })).toBeNull();
  });

  it("rejects a joinUrl that is not https, then falls back to the text", () => {
    expect(extractJoinUrl({ onlineMeeting: { joinUrl: "http://teams.microsoft.com/x" } })).toBeNull();
    expect(extractJoinUrl({ onlineMeeting: { joinUrl: "javascript:alert(1)" } })).toBeNull();
    expect(
      extractJoinUrl({ onlineMeeting: { joinUrl: "http://teams.microsoft.com/x" }, location: { displayName: "https://zoom.us/j/9" } }),
    ).toBe("https://zoom.us/j/9");
  });
});

describe("consult detection", () => {
  it.each(["Strategy Session with Amara", "DISCOVERY CALL", "Free consultation", "Initial call: trademark"])("title %s is a consult", (title) => {
    expect(isConsultTitle(title)).toBe(true);
    expect(isConsult({ title, leadId: null, organizerEmail: null, firmAddresses: FIRM })).toBe(true);
  });

  it("a linked lead plus a firm organizer is a consult, whatever the title", () => {
    expect(isConsult({ title: "Catch up", leadId: "L1", organizerEmail: "rebecca@firm.example", firmAddresses: FIRM })).toBe(true);
    expect(isConsult({ title: null, leadId: "L1", organizerEmail: "intake@firm.example", firmAddresses: FIRM })).toBe(true);
  });

  it("no title match and no linked lead is not a consult, even from a firm organizer", () => {
    expect(isConsult({ title: "Team lunch", leadId: null, organizerEmail: "rebecca@firm.example", firmAddresses: FIRM })).toBe(false);
  });

  it("an organizer outside the firm's mailboxes does not count", () => {
    expect(isConsult({ title: "Catch up", leadId: "L1", organizerEmail: "someone@elsewhere.example", firmAddresses: FIRM })).toBe(false);
    expect(isConsult({ title: "Catch up", leadId: "L1", organizerEmail: null, firmAddresses: FIRM })).toBe(false);
  });
});

describe("attendees", () => {
  it("lowercases, trims, de-duplicates and drops blanks and non-addresses", () => {
    expect(normaliseAttendees([" Amara@Example.COM ", "amara@example.com", "", "   ", null, undefined, "/O=EXCH/CN=Recipients/x", "b@x.org"])).toEqual([
      "amara@example.com",
      "b@x.org",
    ]);
  });

  it("caps at 50", () => {
    const many = Array.from({ length: 80 }, (_, i) => `p${i}@x.org`);
    const out = normaliseAttendees(many);
    expect(out).toHaveLength(50);
    expect(out[49]).toBe("p49@x.org");
  });
});

describe("lead link", () => {
  const index = buildLeadIndex([
    { id: "L1", email: "Amara@Example.com" },
    { id: "L2", email: "ben@example.com" },
    { id: "L3", email: "shared@example.com" },
    { id: "L4", email: "SHARED@example.com" },
    { id: "L5", email: null },
  ]);

  it("one unique lead links, matched case-insensitively and exactly", () => {
    expect(linkLead(["amara@example.com"], index)).toBe("L1");
    expect(linkLead(["x@y.org", "amara@example.com"], index)).toBe("L1");
    expect(linkLead(["amara@example.com.au"], index)).toBeNull();
  });

  it("no match is null", () => {
    expect(linkLead(["nobody@example.com"], index)).toBeNull();
    expect(linkLead([], index)).toBeNull();
  });

  it("one address on two leads is null, never a guess", () => {
    expect(linkLead(["shared@example.com"], index)).toBeNull();
  });

  it("two attendees on two different leads is null", () => {
    expect(linkLead(["amara@example.com", "ben@example.com"], index)).toBeNull();
  });

  it("the same lead named twice still links", () => {
    expect(linkLead(["amara@example.com", "AMARA@example.com"], buildLeadIndex([{ id: "L1", email: "amara@example.com" }]))).toBe("L1");
  });
});

describe("times", () => {
  it("reads Graph's zoneless UTC timestamp, with its seven fraction digits", () => {
    expect(graphInstant({ dateTime: "2026-10-22T14:00:00.0000000", timeZone: "UTC" })).toBe("2026-10-22T14:00:00.000Z");
  });
  it("refuses a zone it cannot convert, and junk", () => {
    expect(graphInstant({ dateTime: "2026-10-22T14:00:00.0000000", timeZone: "Pacific Standard Time" })).toBeNull();
    expect(graphInstant({ dateTime: "not a date", timeZone: "UTC" })).toBeNull();
    expect(graphInstant(null)).toBeNull();
  });
});

describe("normaliseGraphEvent", () => {
  const ctx = {
    leadIndex: buildLeadIndex([{ id: "L1", email: "amara@example.com" }]),
    firmAddresses: FIRM,
  };
  const base: GraphEvent = {
    id: "evt-1",
    subject: "  Strategy Session  ",
    start: { dateTime: "2026-10-22T14:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-10-22T14:30:00.0000000", timeZone: "UTC" },
    isAllDay: false,
    isCancelled: false,
    location: { displayName: "Microsoft Teams Meeting" },
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
    organizer: { emailAddress: { address: "Rebecca@Firm.example" } },
    attendees: [{ emailAddress: { address: "Amara@Example.com" } }, { emailAddress: { address: "rebecca@firm.example" } }],
    bodyPreview: "x",
  };

  it("produces exactly the allow-listed fields", () => {
    const out = normaliseGraphEvent(base, ctx)!;
    expect(out.externalId).toBe("evt-1");
    expect(Object.keys(out.row).sort()).toEqual(
      ["all_day", "attendee_emails", "ends_at", "is_consult", "join_url", "lead_id", "location", "organizer_email", "starts_at", "title"].sort(),
    );
    expect(out.row).toMatchObject({
      title: "Strategy Session",
      starts_at: "2026-10-22T14:00:00.000Z",
      ends_at: "2026-10-22T14:30:00.000Z",
      all_day: false,
      join_url: "https://teams.microsoft.com/l/meetup-join/abc",
      organizer_email: "rebecca@firm.example",
      attendee_emails: ["amara@example.com", "rebecca@firm.example"],
      is_consult: true,
      lead_id: "L1",
    });
  });

  it("carries neither the body nor the preview, whatever the payload holds", () => {
    const SENTINEL = "SENTINEL-PRIVATE-BODY-TEXT";
    const out = normaliseGraphEvent(
      { ...base, bodyPreview: SENTINEL, body: { content: SENTINEL }, org_id: "other-org", lead_id: "forged" } as GraphEvent,
      ctx,
    )!;
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain(SENTINEL);
    expect(serialised).not.toContain("other-org");
    expect(serialised).not.toContain("forged");
    expect(out.row.lead_id).toBe("L1");
  });

  it("does not store a cancelled event, or one with no id or no usable start", () => {
    expect(normaliseGraphEvent({ ...base, isCancelled: true }, ctx)).toBeNull();
    expect(normaliseGraphEvent({ ...base, id: "" }, ctx)).toBeNull();
    expect(normaliseGraphEvent({ ...base, start: { dateTime: "junk", timeZone: "UTC" } }, ctx)).toBeNull();
  });

  it("drops an end before the start rather than storing it", () => {
    const out = normaliseGraphEvent({ ...base, end: { dateTime: "2026-10-22T13:00:00.0000000", timeZone: "UTC" } }, ctx)!;
    expect(out.row.ends_at).toBeNull();
  });

  it("flags by the second rule alone: untitled-as-consult event, one linked lead, firm organizer", () => {
    const plain: GraphEvent = { ...base, subject: "Catch up", onlineMeeting: null };
    expect(normaliseGraphEvent(plain, ctx)!.row.is_consult).toBe(true);
    const outside: GraphEvent = { ...plain, organizer: { emailAddress: { address: "stranger@elsewhere.example" } } };
    expect(normaliseGraphEvent(outside, ctx)!.row.is_consult).toBe(false);
  });
});
