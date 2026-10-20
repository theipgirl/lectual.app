import type { ConsultRead } from "@/lib/consult/store";
import type { StoredConsultDetails } from "@/lib/consult/vocab";

/**
 * What the consult strip on a proposal shows, from one read of the lead's
 * consult notes. Pure.
 *
 * Three states, never two: `details` (a consult with recorded details, reviewed
 * or not), `none` (the read worked and nothing has been recorded) and
 * `unavailable` (the read failed, or the newest record can't be read). A failed
 * read is never `none`.
 *
 * The NEWEST note that has details decides, the same rule `loadReviewedConsult`
 * uses to carry details onto a matter: an older reviewed record is never shown
 * as current while a newer one is waiting or unreadable.
 */

export type ConsultStripState =
  | {
      status: "details";
      noteId: string;
      createdAt: string;
      /** crm_consult_note.transcript_source: fathom, zoom, manual... */
      source: string | null;
      details: StoredConsultDetails;
      /** A person has reviewed these details. When false they are not yet to be relied on. */
      reviewed: boolean;
    }
  | { status: "none" }
  | { status: "unavailable"; unreadable: boolean };

export function consultStripState(read: ConsultRead): ConsultStripState {
  if (read.status !== "ok") return { status: "unavailable", unreadable: false };
  for (const entry of read.entries) {
    if (entry.read.kind === "none") continue;
    if (entry.read.kind === "invalid") return { status: "unavailable", unreadable: true };
    return {
      status: "details",
      noteId: entry.noteId,
      createdAt: entry.createdAt,
      source: entry.source,
      details: entry.read.details,
      reviewed: !!entry.read.details.review,
    };
  }
  return { status: "none" };
}
