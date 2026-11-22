import type { ReviewKind } from "./buckets";

/**
 * The Sheet's Notes column. Pure: which note a row shows, how it is clipped, and the one-save-per-edit rule of the
 * inline editor. No database, no React. The note itself is written by the existing review action
 * (`logWhatHappenedAction`: a plain `note`, which counts as last contact); this only decides what is drawn and posted.
 */

/** The cell shows the note's first line, clipped to this many characters. */
export const SHEET_NOTE_CLIP = 80;

/** What the cell shows: the first line of the newest plain note and its firm-calendar date (YYYY-MM-DD). */
export type SheetNote = { text: string; date: string };

/** Three states: read and found (or found nothing: no key), or couldn't be read (never drawn as "no note"). */
export type SheetNotes = { status: "ok"; byKey: ReadonlyMap<string, SheetNote> } | { status: "unavailable" };

/** One `note` row as the loader reads it: the ids, the date and the three payload keys a note's text may live under. */
export type SheetNoteRowIn = {
  lead_id: string | null;
  matter_id: string | null;
  created_at: string;
  note?: string | null;
  body?: string | null;
  text?: string | null;
};

export function sheetNoteKey(kind: ReviewKind, id: string): string {
  return `${kind}:${id}`;
}

/** The first non-blank line, trimmed and clipped; null when there is no text at all. */
export function noteFirstLine(raw: string | null | undefined, max = SHEET_NOTE_CLIP): string | null {
  if (typeof raw !== "string") return null;
  const line = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The newest note with text per record (a matter by `matter_id`, a lead by `lead_id`). `civilDate` turns the
 * timestamp into the firm's calendar date. Rows may come in any order; the newest `created_at` wins.
 */
export function pickLatestNotes(rows: readonly SheetNoteRowIn[], civilDate: (iso: string) => string): Map<string, SheetNote> {
  const best = new Map<string, { at: string; text: string }>();
  for (const r of rows) {
    const text = [r.note, r.body, r.text].map((v) => noteFirstLine(v)).find((v): v is string => !!v);
    if (!text) continue;
    const key = r.matter_id ? sheetNoteKey("matter", r.matter_id) : r.lead_id ? sheetNoteKey("lead", r.lead_id) : null;
    if (!key) continue;
    const had = best.get(key);
    if (!had || r.created_at > had.at) best.set(key, { at: r.created_at, text });
  }
  const out = new Map<string, SheetNote>();
  for (const [k, v] of best) out.set(k, { text: v.text, date: civilDate(v.at) });
  return out;
}

/** The cell's state for one row: a note, none (an empty cell), or couldn't load. */
export type NoteCell = { state: "note"; note: SheetNote } | { state: "none" } | { state: "unavailable" };

export function noteCellFor(notes: SheetNotes | null | undefined, row: { kind: ReviewKind; id: string }): NoteCell {
  if (!notes || notes.status !== "ok") return { state: "unavailable" };
  const note = notes.byKey.get(sheetNoteKey(row.kind, row.id));
  return note ? { state: "note", note } : { state: "none" };
}

/** What a key press in the editor means. Enter without Shift saves; Shift+Enter is a line break; Esc cancels. */
export function noteKeyIntent(key: string, shift: boolean, composing = false): "commit" | "cancel" | "none" {
  if (composing) return "none";
  if (key === "Enter" && !shift) return "commit";
  if (key === "Escape") return "cancel";
  return "none";
}

export type NoteSaveResult = { ok: boolean; message?: string | null };
export type NoteCommitOutcome = "empty" | "saved" | "failed" | "ignored";

/**
 * One edit session's save rule. Enter, then the blur that follows it, post ONCE: while a save is in flight, or after the
 * session ended (saved, emptied or cancelled), a commit is ignored. Empty text saves nothing. A failed save reopens the
 * session so the person can try again with the text they typed (the text is never thrown away here).
 */
export function noteCommitter(save: (body: string) => Promise<NoteSaveResult>) {
  let busy = false;
  let ended = false;
  return {
    async commit(raw: string): Promise<NoteCommitOutcome> {
      if (busy || ended) return "ignored";
      const body = raw.trim();
      if (!body) {
        ended = true;
        return "empty";
      }
      busy = true;
      let ok = false;
      try {
        ok = (await save(body)).ok;
      } catch {
        ok = false;
      }
      busy = false;
      if (ok) ended = true;
      return ok ? "saved" : "failed";
    },
    cancel() {
      ended = true;
    },
    get busy() {
      return busy;
    },
    get ended() {
      return ended;
    },
  };
}
