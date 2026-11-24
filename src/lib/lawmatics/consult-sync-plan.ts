/**
 * The Lawmatics daily sync's consult step, decided. PURE: no database, no network, the clock is passed in.
 *
 * In: the events read from the firm's Lawmatics (already normalised), the firm's leads (with their merge
 * pointer) and matters, and the rows this sync wrote before (`external_id` starting `lmsync:`). Out: the rows
 * to write, the rows to remove, and the prospect ids that need a targeted read before a lead can be linked.
 *
 * Rules (contract `spec-lawmatics-daily-sync.md`, part (b)):
 *   - Window: an event that starts from now - 7 days to now + 60 days. Outside it, ignored.
 *   - Consult: lawmatics-mcp's `isConsult` (the same words as `isConsultTitle`) on the event TYPE name OR the
 *     title. Only consults are stored. One of this sync's rows that is no longer a consult goes like a vanished one.
 *   - Lead: (1) the event's prospect id on a lead (`lawmatics_id`), followed to the keeper; (2) else exactly ONE
 *     lead whose email equals an attendee's, followed to the keeper; (3) else, when the event names a prospect
 *     no lead holds, the caller reads that prospect (`needProspects`) and plans again; (4) else unlinked.
 *   - Matter: the one matter whose `lawmatics_id` equals the prospect id, else none.
 *   - Removal, only of this sync's own rows (`lmsync:`) starting in the window, comes in two kinds:
 *       positive  the event was READ and is cancelled, no longer a consult, or now outside the window: removed whenever it
 *                 is seen (the read itself says so), even on a read that is otherwise incomplete;
 *       vanished  the event is missing from the read: removed only after a COMPLETE read, and held (counted) when the read
 *                 looks wrong: it returned no records while stored rows exist, or it would remove more than half of the
 *                 stored rows (at least `VANISH_GUARD_MIN` of them).
 *     A record the normaliser couldn't read but whose id is known holds its own `lmsync:<id>` row only (`heldIds`).
 *     A row whose stored fields already match is not written again.
 *   - Never stored: location, attendee addresses, organizer, contact name, description. They are null here.
 */
import { isConsultTitle } from "@/lib/calendar/outlook-parse";
import { keeperIn, type MergePointer } from "@/lib/leads/live";
import { LMSYNC_PREFIX, type LawmaticsEvent } from "./events-normalize";

export const CONSULT_LOOKBACK_DAYS = 7;
export const CONSULT_LOOKAHEAD_DAYS = 60;
export const CONSULT_WRITE_CAP = 500;
export const CONSULT_REMOVE_CAP = 200;
/** The "more than half vanished" guard applies only from this many vanished rows, so one deleted consult can still go. */
export const VANISH_GUARD_MIN = 3;

/** Why vanished rows were not removed this run (counted, never silent). */
export type RemovalHold = "incomplete" | "empty-read" | "too-many-vanished";
const DAY_MS = 86_400_000;

export type ConsultLead = MergePointer & { email: string | null; lawmatics_id: string | null };
export type ConsultMatter = { id: string; lawmatics_id: string | null };
/** One of this sync's rows as stored (only the fields it writes). */
export type OwnConsultRow = {
  id: string;
  external_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean | null;
  event_type: string | null;
  lead_id: string | null;
  matter_id: string | null;
  join_url: string | null;
  is_consult: boolean | null;
};

/** The columns this sync writes. `org_id` and `synced_at` are stamped by the runner. */
export type ConsultRowWrite = {
  source: "lawmatics";
  external_id: string;
  lawmatics_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  event_type: string | null;
  lead_id: string | null;
  matter_id: string | null;
  is_consult: true;
  join_url: string | null;
  location: null;
  attendee_emails: null;
  organizer_email: null;
  contact_name: null;
};

export type ConsultPlan = {
  writes: ConsultRowWrite[];
  /** Ids of this sync's own rows to delete (complete reads only). */
  removeIds: string[];
  /** Prospect ids named by a consult in the window that no lead holds: read them, then plan again. */
  needProspects: string[];
  counts: {
    read: number;
    consults: number;
    notConsult: number;
    outsideWindow: number;
    cancelled: number;
    unchanged: number;
    unlinked: number;
    overWriteCap: number;
    overRemoveCap: number;
  };
  /** Set when vanished rows were held this run. Positive removals are not affected. */
  removalHold: RemovalHold | null;
};

export const lmsyncExternalId = (eventId: string) => `${LMSYNC_PREFIX}${eventId}`;
export const isOwnExternalId = (externalId: string | null | undefined) => typeof externalId === "string" && externalId.startsWith(LMSYNC_PREFIX);

/** lawmatics-mcp `isConsult` (src/consult.ts), mirrored: the same words as `isConsultTitle`, on the type name OR the title. */
export function isLawmaticsConsult(event: Pick<LawmaticsEvent, "title" | "eventTypeName">): boolean {
  return isConsultTitle(event.eventTypeName) || isConsultTitle(event.title);
}

export function consultWindow(nowMs: number): { from: number; to: number } {
  return { from: nowMs - CONSULT_LOOKBACK_DAYS * DAY_MS, to: nowMs + CONSULT_LOOKAHEAD_DAYS * DAY_MS };
}

function lower(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return t || null;
}

/** Lead lookups: a prospect id to its keeper, an address to the set of keepers that carry it. */
export function consultLeadIndex(leads: readonly ConsultLead[]) {
  const byId = new Map<string, MergePointer>(leads.map((l) => [l.id, l]));
  const byLawmatics = new Map<string, Set<string>>();
  const byEmail = new Map<string, Set<string>>();
  for (const l of leads) {
    const keeper = keeperIn(l.id, byId);
    if (!keeper) continue;
    if (l.lawmatics_id) byLawmatics.set(l.lawmatics_id, (byLawmatics.get(l.lawmatics_id) ?? new Set()).add(keeper));
    const e = lower(l.email);
    if (e) byEmail.set(e, (byEmail.get(e) ?? new Set()).add(keeper));
  }
  return { byLawmatics, byEmail };
}

type LeadIndex = ReturnType<typeof consultLeadIndex>;

/** The lead an event belongs to, or `{ prospect }` when only a targeted read could tell, or null. */
export function linkConsultLead(event: Pick<LawmaticsEvent, "prospectId" | "attendeeEmails">, index: LeadIndex): { leadId: string } | { prospect: string } | null {
  if (event.prospectId) {
    const hit = index.byLawmatics.get(event.prospectId);
    if (hit && hit.size === 1) return { leadId: [...hit][0] };
  }
  const found = new Set<string>();
  for (const e of event.attendeeEmails) for (const id of index.byEmail.get(e) ?? []) found.add(id);
  if (found.size === 1) return { leadId: [...found][0] };
  if (event.prospectId && !index.byLawmatics.has(event.prospectId)) return { prospect: event.prospectId };
  return null;
}

function sameStored(a: ConsultRowWrite, b: OwnConsultRow): boolean {
  const t = (x: string | null) => (x ? Date.parse(x) : null);
  return (
    a.title === b.title &&
    t(a.starts_at) === t(b.starts_at) &&
    t(a.ends_at) === t(b.ends_at) &&
    a.all_day === (b.all_day === true) &&
    a.event_type === b.event_type &&
    a.lead_id === b.lead_id &&
    a.matter_id === b.matter_id &&
    a.join_url === b.join_url &&
    b.is_consult === true
  );
}

export function planConsults(input: {
  events: readonly LawmaticsEvent[];
  leads: readonly ConsultLead[];
  matters: readonly ConsultMatter[];
  ownRows: readonly OwnConsultRow[];
  nowMs: number;
  /**
   * True only when every page was read, nothing was cut short, the shape was recognised, every record had an id and the step
   * was in time. False holds vanished removals only; positive ones still happen.
   */
  complete: boolean;
  /** Ids of records the normaliser couldn't read: their own rows are kept untouched. */
  heldIds?: readonly string[];
  /** How many records the read returned (usable or not), for the empty-read guard. Defaults to the events given. */
  recordsRead?: number;
}): ConsultPlan {
  const { from, to } = consultWindow(input.nowMs);
  const index = consultLeadIndex(input.leads);
  const mattersByLawmatics = new Map<string, string[]>();
  for (const m of input.matters) if (m.lawmatics_id) mattersByLawmatics.set(m.lawmatics_id, [...(mattersByLawmatics.get(m.lawmatics_id) ?? []), m.id]);
  const own = new Map(input.ownRows.filter((r) => isOwnExternalId(r.external_id)).map((r) => [r.external_id, r]));

  const counts: ConsultPlan["counts"] = { read: input.events.length, consults: 0, notConsult: 0, outsideWindow: 0, cancelled: 0, unchanged: 0, unlinked: 0, overWriteCap: 0, overRemoveCap: 0 };
  const writes: ConsultRowWrite[] = [];
  const keep = new Set<string>((input.heldIds ?? []).map(lmsyncExternalId));
  /** Rows whose event this read saw as cancelled, not a consult, or out of the window: removed on that evidence. */
  const positive = new Set<string>();
  const needProspects = new Set<string>();
  const seen = new Set<string>();

  for (const e of input.events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const start = Date.parse(e.startsAt);
    if (!Number.isFinite(start) || start < from || start > to) {
      // Ignored. A stored row still inside the window for an event that moved out of it is then removed
      // (a complete read only), so the calendar never shows the old date.
      counts.outsideWindow += 1;
      positive.add(lmsyncExternalId(e.id));
      continue;
    }
    if (e.cancelled) {
      counts.cancelled += 1;
      positive.add(lmsyncExternalId(e.id));
      continue;
    }
    if (!isLawmaticsConsult(e)) {
      counts.notConsult += 1;
      positive.add(lmsyncExternalId(e.id));
      continue;
    }
    counts.consults += 1;
    const externalId = lmsyncExternalId(e.id);
    keep.add(externalId);
    const link = linkConsultLead(e, index);
    let leadId: string | null = null;
    if (link && "leadId" in link) leadId = link.leadId;
    else {
      if (link) needProspects.add(link.prospect);
      counts.unlinked += 1;
    }
    const matterIds = e.prospectId ? (mattersByLawmatics.get(e.prospectId) ?? []) : [];
    const row: ConsultRowWrite = {
      source: "lawmatics",
      external_id: externalId,
      lawmatics_id: e.id,
      title: e.title,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      all_day: e.allDay,
      event_type: e.eventTypeName,
      lead_id: leadId,
      matter_id: matterIds.length === 1 ? matterIds[0] : null,
      is_consult: true,
      join_url: e.joinUrl,
      location: null,
      attendee_emails: null,
      organizer_email: null,
      contact_name: null,
    };
    const stored = own.get(externalId);
    if (stored && sameStored(row, stored)) {
      counts.unchanged += 1;
      continue;
    }
    if (writes.length >= CONSULT_WRITE_CAP) {
      counts.overWriteCap += 1;
      continue;
    }
    writes.push(row);
  }

  const inWindow = [...own.values()].filter((r) => {
    const start = Date.parse(r.starts_at);
    return Number.isFinite(start) && start >= from && start <= to;
  });
  const positiveRows = inWindow.filter((r) => !keep.has(r.external_id) && positive.has(r.external_id));
  const vanishedRows = inWindow.filter((r) => !keep.has(r.external_id) && !positive.has(r.external_id));
  const recordsRead = input.recordsRead ?? input.events.length;
  let removalHold: RemovalHold | null = null;
  if (vanishedRows.length > 0) {
    if (!input.complete) removalHold = "incomplete";
    else if (recordsRead === 0) removalHold = "empty-read";
    else if (vanishedRows.length >= VANISH_GUARD_MIN && vanishedRows.length * 2 > inWindow.length) removalHold = "too-many-vanished";
  }
  const removeIds: string[] = [];
  for (const r of [...positiveRows, ...(removalHold ? [] : vanishedRows)]) {
    if (removeIds.length >= CONSULT_REMOVE_CAP) {
      counts.overRemoveCap += 1;
      continue;
    }
    removeIds.push(r.id);
  }

  return { writes, removeIds, needProspects: [...needProspects], counts, removalHold };
}
