import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { addDays, zonedParts } from "./grid";
import { isDatabaseUpdateNeeded } from "./outlook-errors";

/**
 * Reads of the Outlook events the daily sync stored in `crm_calendar_event`.
 * Every read goes through the caller's RLS-scoped client and answers one of
 * three states, never a bare array:
 *
 *   ok                      we reached the table; an empty list means none
 *   database-update-needed  lectual 0098 isn't applied here, so the Outlook
 *                           columns don't exist yet
 *   unavailable             the read failed or threw
 *
 * A failed read must never look like "no events" or "no consult booked".
 */

export type OutlookCalendarEvent = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean | null;
  location: string | null;
  event_type: string | null;
  contact_name: string | null;
  matter_id: string | null;
  source: string;
  join_url: string | null;
  is_consult: boolean;
  lead_id: string | null;
};

export type OutlookRead<T> =
  | ({ status: "ok" } & T)
  | { status: "database-update-needed" }
  | { status: "unavailable" };

const COLUMNS =
  "id, title, starts_at, ends_at, all_day, location, event_type, contact_name, matter_id, source, join_url, is_consult, lead_id";

type Failure = { status: "database-update-needed" } | { status: "unavailable" };

function failure(error: { code?: string; message?: string }): Failure {
  return isDatabaseUpdateNeeded(error) ? { status: "database-update-needed" } : { status: "unavailable" };
}

/** Outlook events starting in [from, to] (civil dates), padded a day each side like the base reader. */
export async function listOutlookCalendarEvents(from: string, to: string): Promise<OutlookRead<{ events: OutlookCalendarEvent[] }>> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_calendar_event")
      .select(COLUMNS)
      .eq("source", "outlook")
      .gte("starts_at", `${addDays(from, -1)}T00:00:00Z`)
      .lt("starts_at", `${addDays(to, 2)}T00:00:00Z`)
      .order("starts_at", { ascending: true })
      .limit(500);
    if (error) return failure(error);
    return { status: "ok", events: (data ?? []) as OutlookCalendarEvent[] };
  } catch {
    return { status: "unavailable" };
  }
}

/** The earliest consult from now on that is linked to this lead. */
export async function loadBookedConsult(
  leadId: string,
  now: Date = new Date(),
): Promise<OutlookRead<{ event: OutlookCalendarEvent | null }>> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_calendar_event")
      .select(COLUMNS)
      .eq("source", "outlook")
      .eq("lead_id", leadId)
      .eq("is_consult", true)
      .gte("starts_at", now.toISOString())
      .order("starts_at", { ascending: true })
      .limit(1);
    if (error) return failure(error);
    const rows = (data ?? []) as OutlookCalendarEvent[];
    return { status: "ok", event: rows[0] ?? null };
  } catch {
    return { status: "unavailable" };
  }
}

export const TODAY_CONSULT_DAYS = 7;
export const TODAY_CONSULT_CAP = 8;

export type TodayConsult = OutlookCalendarEvent & {
  /** The linked lead's name, when it could be read. */
  lead_name: string | null;
};

/** Consults starting today (firm zone) or in the next 7 days, soonest first, at most 8. */
export async function loadConsultsForToday(
  now: Date,
  timeZone: string,
): Promise<OutlookRead<{ consults: TodayConsult[] }>> {
  try {
    const today = zonedParts(now.toISOString(), timeZone).date;
    const last = addDays(today, TODAY_CONSULT_DAYS);
    const supabase = await getScopedClient();
    // Padded a day each side; the firm-zone date below decides what is "today".
    const { data, error } = await supabase
      .from("crm_calendar_event")
      .select(COLUMNS)
      .eq("source", "outlook")
      .eq("is_consult", true)
      .gte("starts_at", `${addDays(today, -1)}T00:00:00Z`)
      .lt("starts_at", `${addDays(last, 2)}T00:00:00Z`)
      .order("starts_at", { ascending: true })
      .limit(100);
    if (error) return failure(error);
    const inWindow = ((data ?? []) as OutlookCalendarEvent[])
      .filter((e) => {
        const date = e.all_day ? e.starts_at.slice(0, 10) : zonedParts(e.starts_at, timeZone).date;
        return date >= today && date <= last;
      })
      .slice(0, TODAY_CONSULT_CAP);
    return { status: "ok", consults: await withLeadNames(inWindow) };
  } catch {
    return { status: "unavailable" };
  }
}

/** Names for the linked leads. Best effort: a failed lookup leaves the name off, the consult still listed. */
async function withLeadNames(events: OutlookCalendarEvent[]): Promise<TodayConsult[]> {
  const ids = [...new Set(events.map((e) => e.lead_id).filter((id): id is string => id !== null))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    try {
      const supabase = await getScopedClient();
      const { data, error } = await supabase
        .from("crm_lead")
        .select("id, first_name, last_name, business_name, email")
        .in("id", ids);
      if (!error) {
        for (const l of data ?? []) {
          const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.business_name || l.email;
          if (name) names.set(l.id, name);
        }
      }
    } catch {
      // The consult is still listed, with a plain "Open lead" link.
    }
  }
  return events.map((e) => ({ ...e, lead_name: e.lead_id ? (names.get(e.lead_id) ?? null) : null }));
}
