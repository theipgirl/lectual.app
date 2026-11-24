/**
 * Lawmatics event (appointment) -> sanitized consult candidate. PURE: no I/O, no clock.
 *
 * NOT VERIFIED against a live Lawmatics (Blocker 1 of the daily-sync contract): the resource is expected at
 * `GET /v1/events`, and the attribute and relationship names below come from the public API reference and
 * lawmatics-mcp's `normalizeEvent`. Several likely spellings are tried, as `hired-sync-normalize.ts` does. A
 * record this cannot read (no id, no start) is UNUSABLE and counted, never guessed.
 *
 * What leaves this module, and nothing else:
 *   - id, title (trimmed, at most 300), start, end, all-day, the event-type name, cancelled, the prospect id;
 *   - `joinUrl`: the first https link in the description whose host is on an allowlist (Zoom, Teams, Meet).
 *     The description itself is read here and DROPPED: no field of the result carries it;
 *   - `attendeeEmails`: lowercased, at most 50, used only to find the lead, then dropped by the caller.
 * The location is never read.
 *
 * Who the event is for: a live Lawmatics event links its person through `relationships.eventable` (type prospect, id
 * only, no name; lawmatics-mcp `src/consult.ts` documents the same). A prospect or matter eventable is the prospect id; a
 * contact eventable adds that contact's email (from the sideload, else the contacts the run already read) to the attendee
 * emails. The person is never matched by name.
 *
 * Times: a start or end with no UTC offset is refused (the event is unusable). Nothing is assumed about a zone.
 * An all-day event is UTC midnight of its civil date with `allDay = true`, the form the calendar readers expect.
 */
import { bag, field, idOf, related, relatedId, relatedName, type Raw } from "./jsonapi";
import { cleanEmail, cleanText } from "./normalize";

export const EVENT_TITLE_MAX = 300;
export const EVENT_ATTENDEES_MAX = 50;
/** `lmsync:` + the Lawmatics id must fit `crm_calendar_event.external_id` (at most 256 characters). */
export const LMSYNC_PREFIX = "lmsync:";
export const EXTERNAL_ID_MAX = 256;
const JOIN_URL_MAX = 2048;

export type LawmaticsEvent = {
  id: string;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  eventTypeName: string | null;
  cancelled: boolean;
  prospectId: string | null;
  joinUrl: string | null;
  attendeeEmails: string[];
};

export type UnusableReason = "no-id" | "id-too-long" | "no-start" | "no-offset" | "end-before-start";

/** On failure `id` is the record's id when it had a usable one, so its own stored row can be held (never removed on a guess). */
export type NormalisedLawmaticsEvent = { ok: true; event: LawmaticsEvent } | { ok: false; reason: UnusableReason; id?: string };

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── join link ────────────────────────────────────────────────────────────────

/** zoom.us and its subdomains, Teams (work and personal), Google Meet. Nothing else is ever stored. */
export function isAllowedJoinHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "zoom.us" || h.endsWith(".zoom.us") || h === "teams.microsoft.com" || h === "teams.live.com" || h === "meet.google.com";
}

/** The first https link in free text whose host is allowed, trailing punctuation trimmed. Null otherwise. */
export function joinUrlIn(text: string | null | undefined): string | null {
  for (const match of (text ?? "").matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const candidate = match[0].replace(/[.,;:!?)\]}]+$/, "");
    if (candidate.length > JOIN_URL_MAX) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    if (isAllowedJoinHost(url.hostname)) return candidate;
  }
  return null;
}

// ── times ────────────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

type ParsedTime = { kind: "instant"; iso: string; date: string } | { kind: "date"; date: string } | { kind: "no-offset" } | { kind: "none" };

export function parseLawmaticsTime(value: string | null): ParsedTime {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "none" };
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) return Number.isFinite(Date.parse(`${dateOnly[1]}T00:00:00Z`)) ? { kind: "date", date: dateOnly[1] } : { kind: "none" };
  if (!WITH_OFFSET.test(raw)) return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw) ? { kind: "no-offset" } : { kind: "none" };
  const ms = Date.parse(raw.replace(" ", "T"));
  if (!Number.isFinite(ms)) return { kind: "none" };
  return { kind: "instant", iso: new Date(ms).toISOString(), date: raw.slice(0, 10) };
}

function bool(rec: Raw, ...keys: string[]): boolean | null {
  const attrs = bag(rec);
  for (const k of keys) {
    for (const src of [attrs, rec]) {
      const v = src[k];
      if (typeof v === "boolean") return v;
      if (v === "true" || v === 1) return true;
      if (v === "false" || v === 0) return false;
    }
  }
  return null;
}

// ── attendees ────────────────────────────────────────────────────────────────

function emailsFrom(value: unknown, included: Map<string, Raw>, out: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (out.size >= EVENT_ATTENDEES_MAX) return;
    if (typeof item === "string") {
      const e = cleanEmail(item);
      if (e) out.add(e);
      continue;
    }
    if (!isRaw(item)) continue;
    const direct = cleanEmail(field(item, "email", "email_address", "primary_email"));
    if (direct) {
      out.add(direct);
      continue;
    }
    // A relationship ref ({ type, id }) resolved through the sideload.
    const type = typeof item.type === "string" ? item.type : null;
    const id = idOf(item);
    const full = type && id ? included.get(`${type}:${id}`) : undefined;
    const e = full ? cleanEmail(field(full, "email", "email_address", "primary_email")) : null;
    if (e) out.add(e);
  }
}

/** A relationship type, case and plural folded: "Prospect", "prospects" and "prospect" are one. */
export function relType(type: unknown): string | null {
  if (typeof type !== "string") return null;
  const t = type.trim().toLowerCase();
  if (!t) return null;
  return t.endsWith("s") ? t.slice(0, -1) : t;
}

/** `relationships.eventable.data` as a folded type and an id, or null. */
export function eventableOf(rec: Raw): { type: string; id: string } | null {
  if (!isRaw(rec.relationships)) return null;
  const rel = rec.relationships.eventable;
  if (!isRaw(rel) || !isRaw(rel.data)) return null;
  const type = relType(rel.data.type);
  const id = idOf(rel.data);
  return type && id ? { type, id } : null;
}

/** A sideloaded record by folded type and id (the sideload may spell the type either way). */
function sideloaded(included: Map<string, Raw>, type: string, id: string): Raw | undefined {
  for (const [key, value] of included) {
    const at = key.lastIndexOf(":");
    if (at > 0 && key.slice(at + 1) === id && relType(key.slice(0, at)) === type) return value;
  }
  return undefined;
}

/** Emails of contacts the run already read, by Lawmatics contact id. Only the email is used. */
export type ContactEmails = ReadonlyMap<string, { email: string | null }>;

function attendeesOf(rec: Raw, included: Map<string, Raw>, contacts: ContactEmails | null): string[] {
  const out = new Set<string>();
  const attrs = bag(rec);
  for (const key of ["invitees", "attendees", "participants", "guests"]) emailsFrom(attrs[key] ?? rec[key], included, out);
  if (isRaw(rec.relationships)) {
    for (const key of ["invitees", "attendees", "participants", "contacts"]) {
      const rel = rec.relationships[key];
      if (isRaw(rel)) emailsFrom(rel.data, included, out);
    }
  }
  // The prospect's own contact email, when it was sideloaded with the event.
  const prospect = related(rec, "prospect", included);
  const pe = prospect ? cleanEmail(field(prospect, "email", "email_address", "primary_email")) : null;
  if (pe && out.size < EVENT_ATTENDEES_MAX) out.add(pe);
  // A contact the event is for: its email from the sideload, else from the contacts already read this run.
  const ev = eventableOf(rec);
  if (ev && ev.type === "contact" && out.size < EVENT_ATTENDEES_MAX) {
    const full = sideloaded(included, "contact", ev.id);
    const ce = (full ? cleanEmail(field(full, "email", "email_address", "primary_email")) : null) ?? cleanEmail(contacts?.get(ev.id)?.email ?? null);
    if (ce) out.add(ce);
  }
  return [...out];
}

// ── the record ───────────────────────────────────────────────────────────────

export function normalizeLawmaticsEvent(rec: Raw, included: Map<string, Raw> = new Map(), contacts: ContactEmails | null = null): NormalisedLawmaticsEvent {
  const id = cleanText(idOf(rec), 1000);
  if (!id) return { ok: false, reason: "no-id" };
  if (LMSYNC_PREFIX.length + id.length > EXTERNAL_ID_MAX) return { ok: false, reason: "id-too-long" };
  const fail = (reason: UnusableReason): NormalisedLawmaticsEvent => ({ ok: false, reason, id });

  const start = parseLawmaticsTime(field(rec, "start_time", "starts_at", "start_at", "start", "start_date", "start_datetime"));
  const end = parseLawmaticsTime(field(rec, "end_time", "ends_at", "end_at", "end", "end_date", "end_datetime"));
  const flaggedAllDay = bool(rec, "all_day", "is_all_day", "allDay") === true;
  if (start.kind === "none") return fail("no-start");
  if (start.kind === "no-offset" || end.kind === "no-offset") return fail("no-offset");

  // A date-only start is a civil date: all-day. A flagged all-day event keeps only its civil date.
  const allDay = flaggedAllDay || start.kind === "date";
  const startsAt = allDay ? `${start.date}T00:00:00.000Z` : (start as { iso: string }).iso;
  let endsAt: string | null = null;
  if (end.kind === "instant" || end.kind === "date") endsAt = allDay ? `${end.date}T00:00:00.000Z` : end.kind === "instant" ? end.iso : `${end.date}T00:00:00.000Z`;
  if (endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) return fail("end-before-start");

  const status = (field(rec, "status", "state") ?? "").trim().toLowerCase();
  const cancelled =
    bool(rec, "cancelled", "canceled", "is_cancelled", "is_canceled", "deleted") === true ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "deleted";

  const eventTypeName = cleanText(
    relatedName(rec, "event_type", included) ?? relatedName(rec, "appointment_type", included) ?? field(rec, "event_type_name", "type_name"),
    200,
  );
  const ev = eventableOf(rec);
  const eventableProspect = ev && (ev.type === "prospect" || ev.type === "matter") ? ev.id : null;
  const prospectId = cleanText(
    relatedId(rec, "prospect") ?? relatedId(rec, "matter") ?? eventableProspect ?? field(rec, "prospect_id", "matter_id"),
    128,
  );
  const description = field(rec, "description", "notes", "body", "details");

  return {
    ok: true,
    event: {
      id,
      title: cleanText(field(rec, "name", "title", "subject"), EVENT_TITLE_MAX),
      startsAt,
      endsAt,
      allDay,
      eventTypeName,
      cancelled,
      prospectId,
      joinUrl: joinUrlIn(description),
      attendeeEmails: attendeesOf(rec, included, contacts),
    },
  };
}
