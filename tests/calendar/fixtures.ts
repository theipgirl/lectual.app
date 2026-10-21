import { buildLeadIndex, normaliseGraphEvent, type GraphEvent } from "@/lib/calendar/outlook-parse";
import type { OutlookCalendarEvent } from "@/lib/calendar/outlook-read";

/** A consult exactly as Graph reports it (Teams meeting, a lead as attendee, mixed-case addresses). */
export const STRATEGY_SESSION: GraphEvent = {
  id: "evt-strategy",
  subject: "Strategy Session: Amara Nwosu",
  start: { dateTime: "2026-10-22T18:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-10-22T18:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  isCancelled: false,
  location: { displayName: "Microsoft Teams Meeting" },
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/strategy-1" },
  organizer: { emailAddress: { address: "Rebecca@Firm.example" } },
  attendees: [{ emailAddress: { address: "Amara@Example.com" } }, { emailAddress: { address: " rebecca@firm.example " } }],
  bodyPreview: "Private words about the client's matter",
};

export const FIRM_ADDRESSES = new Set(["rebecca@firm.example", "intake@firm.example"]);
export const LEADS = [{ id: "lead-amara", email: "amara@example.com" }];

/** What the sync stores for STRATEGY_SESSION, shaped as the readers return it. */
export function storedConsult(over: Partial<OutlookCalendarEvent> = {}): OutlookCalendarEvent {
  const out = normaliseGraphEvent(STRATEGY_SESSION, { leadIndex: buildLeadIndex(LEADS), firmAddresses: FIRM_ADDRESSES })!;
  return {
    id: "row-1",
    title: out.row.title,
    starts_at: out.row.starts_at,
    ends_at: out.row.ends_at,
    all_day: out.row.all_day,
    location: out.row.location,
    event_type: null,
    contact_name: null,
    matter_id: null,
    source: "outlook",
    join_url: out.row.join_url,
    is_consult: out.row.is_consult,
    lead_id: out.row.lead_id,
    ...over,
  };
}
