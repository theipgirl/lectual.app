import {
  matterFieldsFromDetails,
  normalizeExtraction,
  readStoredDetails,
  withConsultDetails,
  type ExtractionSource,
  type MatterCarry,
  type StoredConsultDetails,
  type StoredRead,
} from "./details";

/**
 * Reads and writes of `crm_consult_note.notes.consult_details`, shared by the
 * three places that touch it: the post-consult agent (service role, fenced by
 * the org of the note it is working), the Meetings "Draft follow-up" action
 * and the lead page (both the signed-in caller's scoped client), and the two
 * paths that open a matter.
 *
 * Takes the client as a parameter and never builds one, so it carries no
 * privilege of its own: whoever calls it chooses the client and, for the
 * service role, supplies the `orgId` that fences every statement. The record
 * lives inside `notes` (jsonb) under its own key rather than in a new column:
 * lectual's notetaker writes `notes` and `classes` in shapes of its own, and
 * this key sits beside them without disturbing either.
 *
 * Every read is three-state — `ok`, `unavailable`, or (for one record) an
 * unreadable value that is reported as such. A failed read is never "no
 * consult details".
 */

type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError };
export interface ConsultQuery extends PromiseLike<DbResult> {
  select(columns: string): ConsultQuery;
  update(patch: Record<string, unknown>): ConsultQuery;
  insert(rows: unknown): ConsultQuery;
  eq(column: string, value: unknown): ConsultQuery;
  is(column: string, value: null): ConsultQuery;
  order(column: string, options?: { ascending?: boolean }): ConsultQuery;
  limit(count: number): ConsultQuery;
  maybeSingle(): PromiseLike<DbResult>;
}
export interface ConsultDb {
  from(table: string): ConsultQuery;
}

/** Notes read per lead. A lead rarely has more than one or two consults. */
export const NOTES_PER_LEAD = 8;

export type ConsultEntry = {
  noteId: string;
  createdAt: string;
  /** `crm_consult_note.transcript_source`: fathom, zoom, manual… */
  source: string | null;
  read: StoredRead;
};
export type ConsultRead = { status: "ok"; entries: ConsultEntry[] } | { status: "unavailable" };

const row = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A lead's consult notes, newest first, each with its details read three ways. */
export async function loadConsultEntries(db: ConsultDb, leadId: string, orgId?: string): Promise<ConsultRead> {
  try {
    let q = db.from("crm_consult_note").select("id, created_at, transcript_source, notes").eq("lead_id", leadId);
    if (orgId) q = q.eq("org_id", orgId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(NOTES_PER_LEAD);
    if (error || !Array.isArray(data)) return { status: "unavailable" };
    return {
      status: "ok",
      entries: data.map((r) => {
        const x = row(r);
        return {
          noteId: String(x.id),
          createdAt: String(x.created_at ?? ""),
          source: typeof x.transcript_source === "string" ? x.transcript_source : null,
          read: readStoredDetails(x.notes),
        };
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export type SaveExtractionResult = "saved" | "kept" | "nothing" | "failed";

/**
 * Stores the model's extraction on a consult note — only where nothing is
 * stored yet. Anything already there, reviewed or not, typed by hand or
 * unreadable, is left exactly as it is: a re-run of a draft must never undo a
 * person's review. The write is conditional on the key still being absent, so
 * a person saving between our read and our write wins.
 *
 * Never throws: the follow-up draft this rides on has already been queued, and
 * a failure here is reported to the caller, not raised.
 */
export async function saveExtraction(
  db: ConsultDb,
  args: { orgId: string; noteId: string; extraction: unknown; source: Exclude<ExtractionSource, "manual">; meetingId?: string | null; now: Date },
): Promise<SaveExtractionResult> {
  try {
    const details = normalizeExtraction(args.extraction, { now: args.now, source: args.source, meetingId: args.meetingId });
    if (!details) return "nothing";
    const { data, error } = await db
      .from("crm_consult_note")
      .select("id, notes")
      .eq("id", args.noteId)
      .eq("org_id", args.orgId)
      .maybeSingle();
    if (error) return "failed";
    if (!data) return "failed";
    const notes = row(data).notes;
    if (readStoredDetails(notes).kind !== "none") return "kept";
    const { data: written, error: writeError } = await db
      .from("crm_consult_note")
      .update({ notes: withConsultDetails(notes, details) })
      .eq("id", args.noteId)
      .eq("org_id", args.orgId)
      .is("notes->consult_details", null)
      .select("id");
    if (writeError) return "failed";
    return Array.isArray(written) && written.length > 0 ? "saved" : "kept";
  } catch {
    return "failed";
  }
}

/** Where a meeting's extraction lives. Namespaced so it can never equal an external meeting id. */
export const meetingNoteRef = (meetingId: string) => `lectual.app:meeting:${meetingId}`;

/**
 * The consult note that carries a meeting's extraction for a lead — found, or
 * created. It is the app's own note, keyed to the meeting, with no summary and
 * no next step: lectual's notetaker may have written a note for the same
 * recording, and claiming THAT one for the lead would hand it to the
 * post-consult agent, which would draft a second follow-up for one call.
 */
export async function findOrCreateMeetingNote(
  db: ConsultDb,
  args: { orgId: string; leadId: string; meetingId: string; provider: string },
): Promise<{ id: string } | null> {
  try {
    const ref = meetingNoteRef(args.meetingId);
    const found = await db
      .from("crm_consult_note")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("lead_id", args.leadId)
      .eq("raw_transcript_ref", ref)
      .limit(1)
      .maybeSingle();
    if (found.error) return null;
    const existing = row(found.data).id;
    if (typeof existing === "string") return { id: existing };
    const { data, error } = await db
      .from("crm_consult_note")
      .insert({ org_id: args.orgId, lead_id: args.leadId, transcript_source: args.provider, raw_transcript_ref: ref, notes: {} })
      .select("id");
    if (error || !Array.isArray(data)) return null;
    const id = row(data[0]).id;
    return typeof id === "string" ? { id } : null;
  } catch {
    return null;
  }
}

/**
 * A meeting's extraction onto its own consult note for the lead the meeting is
 * linked to. The note is created only once there is something usable to put on
 * it: a consult note is also what marks a lead as "consulted", so an empty one
 * would say a consult happened when the model returned nothing.
 */
export async function saveMeetingExtraction(
  db: ConsultDb,
  args: { orgId: string; leadId: string; meetingId: string; provider: string; extraction: unknown; now: Date },
): Promise<SaveExtractionResult> {
  try {
    if (!normalizeExtraction(args.extraction, { now: args.now, source: "meeting-follow-up", meetingId: args.meetingId })) return "nothing";
    const note = await findOrCreateMeetingNote(db, args);
    if (!note) return "failed";
    return await saveExtraction(db, {
      orgId: args.orgId,
      noteId: note.id,
      extraction: args.extraction,
      source: "meeting-follow-up",
      meetingId: args.meetingId,
      now: args.now,
    });
  } catch {
    return "failed";
  }
}

/* ───────────────────── the reviewed record, for a matter ─────────────────── */

export type ReviewedConsultRead =
  | { status: "ok"; details: StoredConsultDetails | null; unreadable: boolean; unreviewed: boolean }
  | { status: "unavailable" };

/** The newest REVIEWED details among a lead's consult notes. Unreviewed ones are never returned. */
export async function loadReviewedConsult(db: ConsultDb, leadId: string, orgId?: string): Promise<ReviewedConsultRead> {
  const read = await loadConsultEntries(db, leadId, orgId);
  if (read.status !== "ok") return { status: "unavailable" };
  let unreadable = false;
  let unreviewed = false;
  for (const e of read.entries) {
    if (e.read.kind === "invalid") unreadable = true;
    if (e.read.kind === "ok" && !e.read.details.review) unreviewed = true;
    if (e.read.kind === "ok" && e.read.details.review) return { status: "ok", details: e.read.details, unreadable, unreviewed };
  }
  return { status: "ok", details: null, unreadable, unreviewed };
}

/**
 * What a newly opened matter should take from the lead's reviewed consult.
 * Never throws and never blocks: opening the matter matters more, and the
 * result says plainly why nothing was carried (the caller records it on the
 * timeline), so a failed read is not mistaken for "nothing to carry".
 */
export async function consultCarryForLead(
  db: ConsultDb,
  args: { leadId: string; orgId?: string; preferredMark: string | null | undefined },
): Promise<MatterCarry> {
  try {
    const read = await loadReviewedConsult(db, args.leadId, args.orgId);
    if (read.status !== "ok") return { fields: {}, carried: [], skipped: "unavailable" };
    if (!read.details) return { fields: {}, carried: [], skipped: read.unreadable ? "unreadable" : read.unreviewed ? "not_reviewed" : "no_details" };
    return matterFieldsFromDetails(read.details, args.preferredMark);
  } catch {
    return { fields: {}, carried: [], skipped: "unavailable" };
  }
}

/** What the `matter_opened` timeline row records about the carry. Empty when there was nothing to say. */
export function carryPayload(carry: MatterCarry): Record<string, unknown> {
  // No consult details at all is the ordinary case and not worth a line.
  if (carry.skipped === "no_details") return {};
  return { consult_details: { carried: carry.carried, skipped: carry.skipped } };
}
