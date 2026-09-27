import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { addDays } from "./grid";

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
};

/**
 * Consults and meetings from crm_calendar_event (synced from Lawmatics) that
 * start inside [from, to], civil dates. Read through the RLS-scoped client.
 * The window is padded a day each side so an event near midnight in the
 * firm's zone is not lost to the UTC boundary; the page places each one by
 * its zoned date. Throws on a failed read so the page can say so.
 */
export async function listCalendarEvents(from: string, to: string): Promise<CalendarEventRow[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_calendar_event")
    .select("id, title, starts_at, ends_at, all_day, location, event_type, contact_name, matter_id")
    .gte("starts_at", `${addDays(from, -1)}T00:00:00Z`)
    .lt("starts_at", `${addDays(to, 2)}T00:00:00Z`)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as CalendarEventRow[];
}
