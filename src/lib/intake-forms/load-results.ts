import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { BoothResultRow } from "./booth-results";
import { CSV_MAX_ROWS, type CsvSubmission } from "./csv";
import type { RangeDays } from "./performance";
import type { ResultSubmission } from "./results";
import type { AssessmentSubmissionRow } from "./assessment-samples";
import { isMissingTableError } from "./store";

/**
 * The Results tab, the event page, the Forms list's event rows and the CSV
 * export read through here: the caller's scoped client only (RLS on
 * `crm_intake_submission` / `crm_booth_scorecard` is org-scoped), read-only,
 * each three-state. A failed read is never zero rows.
 *
 * Reads are paged (PostgREST caps a response) up to a stated ceiling, and the
 * ceiling is reported, never silent.
 */

export type Load<T> = { status: "ok"; value: T } | { status: "unconfigured" } | { status: "unavailable"; error?: unknown };

const PAGE = 1000;
/** Rows behind one intake's Results tab; past it the page says the tab covers the latest ones. */
export const RESULT_ROW_LIMIT = 5000;
/** Booth cards behind the Forms list's event rows. */
export const EVENT_LIST_ROW_LIMIT = 20_000;
/** Booth cards behind one event page. */
export const EVENT_ROW_LIMIT = 5000;

type PageResult<T> = { data: T[] | null; error: unknown };

/** Reads pages of `PAGE` rows until a short page or `max` rows; `capped` when it stopped at `max`. */
async function readPages<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, max: number): Promise<Load<{ rows: T[]; capped: boolean }>> {
  const rows: T[] = [];
  for (let from = 0; rows.length < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return isMissingTableError(error as { code?: string }) ? { status: "unconfigured" } : { status: "unavailable", error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { status: "ok", value: { rows, capped: false } };
  }
  return { status: "ok", value: { rows: rows.slice(0, max), capped: true } };
}

const sinceOf = (range: RangeDays, now: Date) => new Date(now.getTime() - range * 86_400_000).toISOString();

// ── an intake's people, for the Results tab ──────────────────────────────────

export type ResultRow = ResultSubmission & AssessmentSubmissionRow;

export async function loadResultSubmissions(formId: string, range: RangeDays, now = new Date()): Promise<Load<{ rows: ResultRow[]; capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    const since = sinceOf(range, now);
    return await readPages<ResultRow>(
      (from, to) =>
        supabase
          .from("crm_intake_submission")
          .select("id, contact, answers, started_at, submitted_at, lead_id, score, band, temperature")
          .eq("form_id", formId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      RESULT_ROW_LIMIT,
    );
  } catch (error) {
    return { status: "unavailable", error };
  }
}

// ── the CSV ──────────────────────────────────────────────────────────────────

export type CsvRead = Load<{ rows: CsvSubmission[]; over: boolean }>;

/**
 * Every person in the range, for the export. Counted first (a head request,
 * no rows) so a firm past `CSV_MAX_ROWS` is told so instead of getting a cut
 * file; the pages then read only the four columns the file shows.
 */
export async function loadCsvSubmissions(formId: string, range: RangeDays, now = new Date()): Promise<CsvRead> {
  try {
    const supabase = await getScopedClient();
    const since = sinceOf(range, now);
    const counted = await supabase
      .from("crm_intake_submission")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .gte("started_at", since);
    if (counted.error) return isMissingTableError(counted.error) ? { status: "unconfigured" } : { status: "unavailable", error: counted.error };
    if ((counted.count ?? 0) > CSV_MAX_ROWS) return { status: "ok", value: { rows: [], over: true } };
    const read = await readPages<CsvSubmission>(
      (from, to) =>
        supabase
          .from("crm_intake_submission")
          .select("contact, answers, started_at, submitted_at")
          .eq("form_id", formId)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      CSV_MAX_ROWS + 1,
    );
    if (read.status !== "ok") return read;
    // Rows that arrived between the count and the pages push it over: refuse rather than cut.
    return { status: "ok", value: { rows: read.value.rows.slice(0, CSV_MAX_ROWS), over: read.value.rows.length > CSV_MAX_ROWS } };
  } catch (error) {
    return { status: "unavailable", error };
  }
}

// ── booth scorecards ─────────────────────────────────────────────────────────

export type EventListRow = Pick<BoothResultRow, "event_code" | "created_at" | "completed_at">;

/** Every booth card's code and times, all time: the Forms list's "Event assessments" rows. */
export async function loadBoothEventList(): Promise<Load<{ rows: EventListRow[]; capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    return await readPages<EventListRow>(
      (from, to) =>
        supabase
          .from("crm_booth_scorecard")
          .select("event_code, created_at, completed_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      EVENT_LIST_ROW_LIMIT,
    );
  } catch (error) {
    return { status: "unavailable", error };
  }
}

/**
 * One event's cards, all time (the page filters by range in memory, so an
 * event with no cards in the range is still known). Names only the columns the
 * page uses: never consent, Lawmatics ids or the attendee's lead.
 */
export async function loadBoothEvent(eventCode: string): Promise<Load<{ rows: BoothResultRow[]; capped: boolean }>> {
  try {
    const supabase = await getScopedClient();
    return await readPages<BoothResultRow>(
      (from, to) =>
        supabase
          .from("crm_booth_scorecard")
          .select("id, event_code, track, score, band, temperature, answers, gaps, created_at, completed_at")
          .eq("event_code", eventCode)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      EVENT_ROW_LIMIT,
    );
  } catch (error) {
    return { status: "unavailable", error };
  }
}
