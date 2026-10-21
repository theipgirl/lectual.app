/**
 * Turning a Microsoft Graph calendar event into the row Lectual stores. Pure:
 * no network, no database, so every rule is tested on its own
 * (tests/calendar/outlook-parse.test.ts).
 *
 * WHAT IS STORED, and nothing else: title, start, end, all-day, location, the
 * join link, the organizer, the attendee addresses, and two derived facts (the
 * lead it belongs to, and whether it is a consult). `OutlookEventRow` is an
 * explicit allow-list. Graph's `bodyPreview` is READ here, to look for a Zoom or
 * Teams link, and is then dropped: no field of the stored row can carry it, and
 * the event body is never even selected.
 */

/** The fields of a Graph event the sync asks for. Everything is optional: Graph omits what is empty. */
export type GraphEvent = {
  id?: string | null;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  isAllDay?: boolean | null;
  isCancelled?: boolean | null;
  location?: { displayName?: string | null } | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  organizer?: { emailAddress?: { address?: string | null } | null } | null;
  attendees?: Array<{ emailAddress?: { address?: string | null } | null } | null> | null;
  /** Read for a join link only. Never stored. */
  bodyPreview?: string | null;
};

/** The columns the sync writes besides the keys (org, source, external id, connection). */
export type OutlookEventRow = {
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  join_url: string | null;
  organizer_email: string | null;
  attendee_emails: string[];
  is_consult: boolean;
  lead_id: string | null;
};

export const MAX_ATTENDEES = 50;
const MAX_TITLE = 500;
const MAX_LOCATION = 500;
const MAX_EMAIL = 320;
const MAX_URL = 2048;

// ── join link ────────────────────────────────────────────────────────────────

const MEETING_HOST_SUFFIXES = ["zoom.us", "zoom.com", "zoomgov.com", "teams.microsoft.com", "teams.live.com"];

function isMeetingHost(host: string): boolean {
  const h = host.toLowerCase();
  return MEETING_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

/** An https URL with no whitespace, short enough for the column, or null. */
function cleanHttps(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || value.length > MAX_URL || /\s/.test(value)) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** The first https Zoom or Teams URL in free text, trailing punctuation trimmed. */
function meetingUrlIn(text: string | null | undefined): string | null {
  for (const match of (text ?? "").matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const candidate = cleanHttps(match[0].replace(/[.,;:!?)\]}]+$/, ""));
    if (!candidate) continue;
    if (isMeetingHost(new URL(candidate).hostname)) return candidate;
  }
  return null;
}

/**
 * `onlineMeeting.joinUrl` when it is an https URL (Graph put it there, so any
 * host is accepted); otherwise the first https Zoom or Teams link in the
 * location text, then in the body preview. Anything else is null: a plain-http
 * or other-host link found in free text is never returned.
 */
export function extractJoinUrl(event: Pick<GraphEvent, "onlineMeeting" | "location" | "bodyPreview">): string | null {
  return (
    cleanHttps(event.onlineMeeting?.joinUrl) ??
    meetingUrlIn(event.location?.displayName) ??
    meetingUrlIn(event.bodyPreview)
  );
}

// ── consult flag ─────────────────────────────────────────────────────────────

const CONSULT_TITLE = /strategy session|discovery call|consult|initial call/i;

export function isConsultTitle(title: string | null | undefined): boolean {
  return CONSULT_TITLE.test(title ?? "");
}

/**
 * A consult when the title says so, or when a lead is linked and the organizer
 * is one of the firm's own connected mailboxes (the firm booked it with them).
 * An organizer outside the firm's mailboxes never counts on its own.
 */
export function isConsult(args: {
  title: string | null;
  leadId: string | null;
  organizerEmail: string | null;
  firmAddresses: ReadonlySet<string>;
}): boolean {
  if (isConsultTitle(args.title)) return true;
  return args.leadId !== null && args.organizerEmail !== null && args.firmAddresses.has(args.organizerEmail);
}

// ── addresses and the lead link ──────────────────────────────────────────────

function cleanEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  // Exchange sometimes reports an internal X500 path instead of an address.
  return value.includes("@") && value.length <= MAX_EMAIL ? value : null;
}

/** Lowercased, trimmed, de-duplicated (first seen order), blanks dropped, at most 50. */
export function normaliseAttendees(raw: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const email = cleanEmail(item);
    if (email) seen.add(email);
    if (seen.size >= MAX_ATTENDEES) break;
  }
  return [...seen];
}

export type LeadIndex = Map<string, Set<string>>;

/** Lowercased lead email -> the distinct leads that carry it (an address can sit on two). */
export function buildLeadIndex(leads: ReadonlyArray<{ id: string; email: string | null }>): LeadIndex {
  const index: LeadIndex = new Map();
  for (const lead of leads) {
    const email = cleanEmail(lead.email);
    if (!email) continue;
    const ids = index.get(email) ?? new Set<string>();
    ids.add(lead.id);
    index.set(email, ids);
  }
  return index;
}

/**
 * The lead this event belongs to: exactly one distinct lead across all the
 * attendee addresses (exact match, case-insensitive). No match, or several
 * leads, is null. It never guesses between two.
 */
export function linkLead(attendees: readonly string[], index: LeadIndex): string | null {
  const found = new Set<string>();
  for (const email of attendees) for (const id of index.get(email) ?? []) found.add(id);
  return found.size === 1 ? [...found][0] : null;
}

// ── times ────────────────────────────────────────────────────────────────────

/**
 * Graph answers in UTC because the request says `Prefer: outlook.timezone="UTC"`,
 * as "2026-10-22T14:00:00.0000000" with no offset. Anything not in UTC is
 * refused rather than guessed at.
 */
export function graphInstant(value: GraphEvent["start"]): string | null {
  const raw = value?.dateTime?.trim();
  if (!raw) return null;
  const zone = (value?.timeZone ?? "UTC").trim().toLowerCase();
  if (zone !== "utc" && zone !== "etc/utc") return null;
  const withoutZone = raw.replace(/(?:Z|[+-]00:?00)$/i, "").replace(/(\.\d{3})\d+$/, "$1");
  const ms = Date.parse(`${withoutZone}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ── the whole event ──────────────────────────────────────────────────────────

export type NormaliseContext = {
  leadIndex: LeadIndex;
  /** Lowercased addresses of the org's connected mailboxes. */
  firmAddresses: ReadonlySet<string>;
};

export type NormalisedEvent = { externalId: string; row: OutlookEventRow };

function clip(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * One Graph event -> the row to store, or null when it should not be stored: no
 * id, no usable start, or cancelled (a cancelled event is treated as vanished).
 * Every stored field is named here; there is no spread of the input.
 */
export function normaliseGraphEvent(event: GraphEvent, ctx: NormaliseContext): NormalisedEvent | null {
  const id = (event.id ?? "").trim();
  if (!id || id.length > 256 || event.isCancelled === true) return null;
  const startsAt = graphInstant(event.start);
  if (!startsAt) return null;
  const rawEnd = graphInstant(event.end);
  const endsAt = rawEnd && Date.parse(rawEnd) >= Date.parse(startsAt) ? rawEnd : null;

  const title = clip(event.subject, MAX_TITLE);
  const organizerEmail = cleanEmail(event.organizer?.emailAddress?.address);
  const attendees = normaliseAttendees((event.attendees ?? []).map((a) => a?.emailAddress?.address));
  const leadId = linkLead(attendees, ctx.leadIndex);

  return {
    externalId: id,
    row: {
      title,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: event.isAllDay === true,
      location: clip(event.location?.displayName, MAX_LOCATION),
      join_url: extractJoinUrl(event),
      organizer_email: organizerEmail,
      attendee_emails: attendees,
      is_consult: isConsult({ title, leadId, organizerEmail, firmAddresses: ctx.firmAddresses }),
      lead_id: leadId,
    },
  };
}
