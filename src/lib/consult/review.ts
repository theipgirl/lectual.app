import {
  applyReview,
  readStoredDetails,
  withConsultDetails,
  type ReviewInput,
  type StoredConsultDetails,
} from "./details";
import type { ConsultDb } from "./store";

/**
 * Saves a person's review of a consult's details: what the lead page's
 * "Consult details" card posts. Takes the client as a parameter — in
 * production the signed-in caller's scoped client, so RLS on org_id is the
 * boundary and another firm's note id is simply not found.
 *
 * A review is the only thing that makes the details eligible to carry onto a
 * matter, so it is guarded like a legal record:
 *
 *  - STALE FORMS ARE REFUSED. Every save bumps `rev`; the form carries the
 *    `rev` it was opened at, and the write itself is conditional on that same
 *    `rev` still being stored. Two people reviewing at once cannot silently
 *    overwrite each other, and a person cannot overwrite what an agent wrote
 *    in the meantime.
 *  - UNREADABLE RECORDS ARE LEFT ALONE rather than replaced by a form that was
 *    built from nothing.
 *  - A NEW RECORD (no note id) is a consult note the staff member is creating
 *    by hand, for a consult the system has no transcript of.
 */

export type SaveReviewResult =
  | { ok: true; details: StoredConsultDetails; noteId: string; created: boolean }
  | { ok: false; error: string };

export const SAVE_FAILED = "Couldn't save the consult details. Try again shortly.";
export const SAVE_STALE = "These details changed while you had them open, so nothing was saved. Reload the page to see the latest.";

export async function saveReview(
  db: ConsultDb,
  args: {
    orgId: string;
    leadId: string;
    /** Null: create a consult note by hand. */
    noteId: string | null;
    /** The `rev` the form was opened at: a number as text, or "none" when nothing was stored. */
    rev: string;
    input: ReviewInput;
    reviewer: { userId: string | null; name: string | null; role: string | null };
    now: Date;
  },
): Promise<SaveReviewResult> {
  try {
    if (!args.noteId) {
      if (args.rev !== "none") return { ok: false, error: SAVE_STALE };
      const details = applyReview(null, args.input, args.reviewer, args.now);
      const { data, error } = await db
        .from("crm_consult_note")
        .insert({ org_id: args.orgId, lead_id: args.leadId, transcript_source: "manual", notes: withConsultDetails({}, details) })
        .select("id");
      const id = Array.isArray(data) ? (data[0] as { id?: unknown } | undefined)?.id : undefined;
      if (error || typeof id !== "string") return { ok: false, error: SAVE_FAILED };
      return { ok: true, details, noteId: id, created: true };
    }

    const { data: note, error: readError } = await db
      .from("crm_consult_note")
      .select("id, notes")
      .eq("id", args.noteId)
      .eq("lead_id", args.leadId)
      .maybeSingle();
    if (readError) return { ok: false, error: SAVE_FAILED };
    if (!note) return { ok: false, error: "That consult note wasn't found." };

    const notes = (note as { notes?: unknown }).notes;
    const stored = readStoredDetails(notes);
    if (stored.kind === "invalid") {
      return { ok: false, error: "The saved details couldn't be read, so they weren't changed. Ask Lectual to take a look." };
    }
    const expected = stored.kind === "ok" ? String(stored.details.rev) : "none";
    if (args.rev !== expected) return { ok: false, error: SAVE_STALE };

    const details = applyReview(stored.kind === "ok" ? stored.details : null, args.input, args.reviewer, args.now);
    let write = db
      .from("crm_consult_note")
      .update({ notes: withConsultDetails(notes, details) })
      .eq("id", args.noteId)
      .eq("lead_id", args.leadId);
    // Conditional on the state we read: only write if nobody got there first.
    write = stored.kind === "ok" ? write.eq("notes->consult_details->>rev", expected) : write.is("notes->consult_details", null);
    const { data: written, error: writeError } = await write.select("id");
    if (writeError) return { ok: false, error: SAVE_FAILED };
    if (!Array.isArray(written) || written.length === 0) return { ok: false, error: SAVE_STALE };
    return { ok: true, details, noteId: args.noteId, created: false };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}
