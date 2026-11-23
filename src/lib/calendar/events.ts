import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { addDays } from "./grid";
import { isDatabaseUpdateNeeded } from "./outlook-errors";

export type CalendarEventRow = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean | null;
  location: string | null;
  event_type: string | null;
  contact_name: string | null;
  matter_id: string | null;
  /** Present once lectual 0098 is applied (null before): which sync wrote the row, its external id, link and lead. */
  source?: string | null;
  external_id?: string | null;
  join_url?: string | null;
  lead_id?: string | null;
  is_consult?: boolean | null;
};

const BASE = "id, title, starts_at, ends_at, all_day, location, event_type, contact_name, matter_id";
const WITH_SOURCE = `${BASE}, source, external_id, join_url, lead_id, is_consult`;

/**
 * Events from crm_calendar_event that start inside [from, to], civil dates, every source (Lawmatics included).
 * It asks for `source`, `external_id`, `join_url`, `lead_id` and `is_consult` too, so the page can label the
 * Lawmatics daily sync's consults and show the same call from Outlook only once; on a database without lectual 0098
 * (42703 / PGRST204) it falls back to the base columns, which is what the table had before. The rows from a
 * connected Outlook calendar are read again with their extra columns by listOutlookCalendarEvents, and the page
 * merges the two by id. Read through the RLS-scoped client.
 * The window is padded a day each side so an event near midnight in the firm's zone is not lost to the UTC
 * boundary; the page places each one by its zoned date. Throws on a failed read so the page can say so.
 */
export async function listCalendarEvents(from: string, to: string): Promise<CalendarEventRow[]> {
  const supabase = await getScopedClient();
  const read = (columns: string) =>
    supabase
      .from("crm_calendar_event")
      .select(columns)
      .gte("starts_at", `${addDays(from, -1)}T00:00:00Z`)
      .lt("starts_at", `${addDays(to, 2)}T00:00:00Z`)
      .order("starts_at", { ascending: true })
      .limit(500);
  const first = await read(WITH_SOURCE);
  if (!first.error) return (first.data ?? []) as unknown as CalendarEventRow[];
  if (!isDatabaseUpdateNeeded(first.error)) throw first.error;
  const { data, error } = await read(BASE);
  if (error) throw error;
  return (data ?? []) as unknown as CalendarEventRow[];
}
