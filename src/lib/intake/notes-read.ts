import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * The "latest note" read behind the Leads page's Next step column. Scoped client only.
 *
 * It replaces `leadActivitySince(since)` on this page. That read took the newest 500 rows of EVERY lead activity type,
 * and a Lawmatics import writes one `lead_created` row per person, so ~300 import rows could eat the cap and push real
 * notes out. This one asks only for the leads on the page (chunks of 100 ids, in parallel) and the four types that carry a
 * note text, pages each chunk (500 a page, at most 4 pages) and says so when a chunk ran out of pages. It also reports
 * FAILURE: the page used to turn a failed read into "no activity".
 *   ok          the newest note per lead; `truncated` = a chunk was cut short, so a lead with no note here may have one
 *   unavailable a chunk failed; the Next step column says so instead of "No activity yet"
 * The page treats `truncated` like `unavailable` for a lead with no note: "Note couldn't load", never "No activity yet".
 */
export const NOTE_LOOKBACK_DAYS = 180;
export const NOTE_PAGE = 500;
export const NOTE_MAX_PAGES = 4;
export const NOTE_ID_CHUNK = 100;
export const NOTE_TYPES = ["note", "call_logged", "email_sent", "voice_note"] as const;

export type NotesRead = { status: "ok"; byLead: Record<string, string>; truncated: boolean } | { status: "unavailable" };

type NoteRow = { lead_id: string | null; type: string; payload: unknown; created_at?: string };

/** A one-line summary out of an activity payload (addLeadNote writes `note`, logged calls `summary`, logged mail `subject`). */
export function noteTextOf(payload: unknown): string | null {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  for (const key of ["note", "summary", "subject", "transcript", "notes"]) {
    const value = p[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** lead id → newest note text; `rows` arrive newest first, so the first hit per lead stands. */
export function latestNotes(rows: readonly NoteRow[]): Record<string, string> {
  const byLead: Record<string, string> = {};
  for (const r of rows) {
    if (!r.lead_id || byLead[r.lead_id]) continue;
    const text = noteTextOf(r.payload);
    if (text) byLead[r.lead_id] = text;
  }
  return byLead;
}

/** Does the Next step column have to say it could not look? Failed, or cut short. */
export function notesIncomplete(read: NotesRead): boolean {
  return read.status !== "ok" || read.truncated;
}

type Page = PromiseLike<{ data: NoteRow[] | null; error: unknown }>;
export type NotesDb = {
  from(table: string): {
    select(cols: string): {
      in(col: string, vals: readonly string[]): {
        in(col: string, vals: readonly string[]): {
          gte(col: string, v: string): { order(col: string, o: { ascending: boolean }): { order(col: string): { range(a: number, b: number): Page } } };
        };
      };
    };
  };
};

async function readChunk(db: NotesDb, ids: readonly string[], sinceIso: string): Promise<{ rows: NoteRow[]; truncated: boolean }> {
  const rows: NoteRow[] = [];
  for (let i = 0; i < NOTE_MAX_PAGES; i++) {
    const { data, error } = await db
      .from("crm_activity")
      .select("lead_id, type, payload")
      .in("lead_id", ids)
      .in("type", NOTE_TYPES)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .order("id")
      .range(i * NOTE_PAGE, i * NOTE_PAGE + NOTE_PAGE - 1);
    if (error) throw new Error("notes read failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < NOTE_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export async function loadLatestNotes(sinceIso: string, leadIds: readonly string[], dbIn?: NotesDb): Promise<NotesRead> {
  const ids = Array.from(new Set(leadIds.filter(Boolean)));
  if (ids.length === 0) return { status: "ok", byLead: {}, truncated: false };
  try {
    const db = dbIn ?? ((await getScopedClient()) as unknown as NotesDb);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += NOTE_ID_CHUNK) chunks.push(ids.slice(i, i + NOTE_ID_CHUNK));
    const parts = await Promise.all(chunks.map((c) => readChunk(db, c, sinceIso)));
    // Each chunk is newest first; merging keeps the newest per lead because a lead's rows are all in one chunk.
    const byLead: Record<string, string> = {};
    for (const p of parts) Object.assign(byLead, latestNotes(p.rows));
    return { status: "ok", byLead, truncated: parts.some((p) => p.truncated) };
  } catch {
    return { status: "unavailable" };
  }
}
