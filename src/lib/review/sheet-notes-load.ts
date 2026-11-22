import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { civilDateIn } from "./build";
import { inChunks, readAllPages } from "./load";
import { pickLatestNotes, type SheetNoteRowIn, type SheetNotes } from "./sheet-notes";
import type { ReviewKind } from "./buckets";

/** The narrow shape of the scoped client this read uses (a test passes a fake). */
type Q = PromiseLike<{ data: SheetNoteRowIn[] | null; error: unknown }> & {
  eq(column: string, value: string): Q;
  in(column: string, values: readonly string[]): Q;
  order(column: string, opts?: { ascending: boolean }): Q;
  range(from: number, to: number): Q;
};
export type NotesDb = { from(table: string): { select(columns: string): Q } };

/** The id, date and the three payload keys a plain note's text may be under. Nothing else of the payload. */
const SELECT = "lead_id, matter_id, created_at, note:payload->>note, body:payload->>body, text:payload->>text";

/**
 * The newest plain `note` of each row ON SCREEN in the Sheet, through the caller's scoped client (RLS): one query per
 * chunk of 80 ids and kind, paged past PostgREST's 1000-row cap (a read that runs out of pages FAILS, it is never cut
 * short). Any failure is `unavailable`, which the cell says out loud; it is never "no note".
 */
export async function readSheetNotes(db: NotesDb, rows: readonly { kind: ReviewKind; id: string }[], timeZone: string): Promise<SheetNotes> {
  const matterIds = [...new Set(rows.filter((r) => r.kind === "matter").map((r) => r.id))];
  const leadIds = [...new Set(rows.filter((r) => r.kind === "lead").map((r) => r.id))];
  try {
    const page = (column: "matter_id" | "lead_id", chunk: string[]) =>
      readAllPages<SheetNoteRowIn>((from, to) => db.from("crm_activity").select(SELECT).eq("type", "note").in(column, chunk).order("created_at", { ascending: false }).order("id").range(from, to));
    const [m, l] = await Promise.all([inChunks(matterIds, (c) => page("matter_id", c)), inChunks(leadIds, (c) => page("lead_id", c))]);
    return { status: "ok", byKey: pickLatestNotes([...m, ...l], (iso) => civilDateIn(iso, timeZone)) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadSheetNotes(rows: readonly { kind: ReviewKind; id: string }[], timeZone: string): Promise<SheetNotes> {
  try {
    const db = (await getScopedClient()) as unknown as NotesDb;
    return await readSheetNotes(db, rows, timeZone);
  } catch {
    return { status: "unavailable" };
  }
}
