import "server-only";
import { civilDateIn } from "./build";
import { pickLatestNotes, type SheetNoteRowIn, type SheetNotes } from "./sheet-notes";
import type { ReviewKind } from "./buckets";

/** The narrow shape of the scoped client this read uses (a test passes a fake). */
type Q = PromiseLike<{ data: SheetNoteRowIn[] | null; error: unknown }> & {
  eq(column: string, value: string): Q;
  order(column: string, opts?: { ascending: boolean }): Q;
  limit(n: number): Q;
};
export type NotesDb = { from(table: string): { select(columns: string): Q } };

/** The id, date and the three payload keys a plain note's text may be under. Nothing else of the payload. */
const SELECT = "lead_id, matter_id, created_at, note:payload->>note, body:payload->>body, text:payload->>text";

/** How many per-record queries run at once. */
export const NOTES_PARALLEL = 12;

/**
 * The newest plain `note` of each given record, through the caller's scoped client (RLS). PostgREST has no "newest per
 * group", so each record is ONE bounded query (`type = note`, its id, newest first, `limit(1)`), run in batches of
 * `NOTES_PARALLEL`: a busy record costs one row, never a sweep of its history. Any failed query makes the whole read
 * `unavailable`, which every Notes cell says out loud; it is never "no note".
 */
export async function readSheetNotes(db: NotesDb, rows: readonly { kind: ReviewKind; id: string }[], timeZone: string): Promise<SheetNotes> {
  const seen = new Set<string>();
  const targets = rows.filter((r) => {
    const k = `${r.kind}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  try {
    const found: SheetNoteRowIn[] = [];
    for (let i = 0; i < targets.length; i += NOTES_PARALLEL) {
      const batch = targets.slice(i, i + NOTES_PARALLEL);
      const answers = await Promise.all(
        batch.map((r) =>
          db
            .from("crm_activity")
            .select(SELECT)
            .eq("type", "note")
            .eq(r.kind === "matter" ? "matter_id" : "lead_id", r.id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1),
        ),
      );
      for (const a of answers) {
        if (a.error) throw a.error;
        found.push(...(a.data ?? []));
      }
    }
    return { status: "ok", byKey: pickLatestNotes(found, (iso) => civilDateIn(iso, timeZone)) };
  } catch {
    return { status: "unavailable" };
  }
}
