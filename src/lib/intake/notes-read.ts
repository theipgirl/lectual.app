import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * The "latest note" read behind the Leads page's Next step column. Scoped client only.
 *
 * It replaces `leadActivitySince(since)` on this page. That read took the newest 500 rows of EVERY lead activity type,
 * and a Lawmatics import writes one `lead_created` row per person, so ~300 import rows could eat the cap and push real
 * notes out. This one asks only for the four types that carry a note text, pages (500 a page, at most 4 pages) and says
 * so when the budget ran out. It also reports FAILURE: the page used to turn a failed read into "no activity".
 *   ok          the newest note per lead (`truncated` = older leads may be missing)
 *   unavailable the read failed; the Next step column says so instead of "No activity yet"
 */
export const NOTE_LOOKBACK_DAYS = 180;
export const NOTE_PAGE = 500;
export const NOTE_MAX_PAGES = 4;
export const NOTE_TYPES = ["note", "call_logged", "email_sent", "voice_note"] as const;

export type NotesRead = { status: "ok"; byLead: Record<string, string>; truncated: boolean } | { status: "unavailable" };

type NoteRow = { lead_id: string | null; type: string; payload: unknown };

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

type Page = PromiseLike<{ data: NoteRow[] | null; error: unknown }>;
export type NotesDb = {
  from(table: string): {
    select(cols: string): {
      in(col: string, vals: readonly string[]): {
        not(col: string, op: string, v: unknown): {
          gte(col: string, v: string): { order(col: string, o: { ascending: boolean }): { order(col: string): { range(a: number, b: number): Page } } };
        };
      };
    };
  };
};

export async function loadLatestNotes(sinceIso: string, dbIn?: NotesDb): Promise<NotesRead> {
  try {
    const db = dbIn ?? ((await getScopedClient()) as unknown as NotesDb);
    const rows: NoteRow[] = [];
    let truncated = false;
    for (let i = 0; i < NOTE_MAX_PAGES; i++) {
      const { data, error } = await db
        .from("crm_activity")
        .select("lead_id, type, payload")
        .in("type", NOTE_TYPES)
        .not("lead_id", "is", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .order("id")
        .range(i * NOTE_PAGE, i * NOTE_PAGE + NOTE_PAGE - 1);
      if (error) return { status: "unavailable" };
      const page = data ?? [];
      rows.push(...page);
      if (page.length < NOTE_PAGE) break;
      if (i === NOTE_MAX_PAGES - 1) truncated = true;
    }
    return { status: "ok", byLead: latestNotes(rows), truncated };
  } catch {
    return { status: "unavailable" };
  }
}
