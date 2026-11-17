import { ROLES, type Role } from "@/lib/auth/roles";
import { NOT_RATED } from "@/lib/ui/words";

/**
 * The event page's "People": who may see them, and how one scorecard becomes a
 * card (and a CSV row). Pure: reads live in `load-results.ts`.
 */

/** Every role except viewer and social media; an unknown or unreadable role is no. */
export function canSeeEventPeople(role: unknown): role is Role {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role) && role !== "viewer" && role !== "social_media";
}

export const EVENT_PEOPLE_CARD_LIMIT = 200;

export type EventCardRow = {
  id: string;
  lead_id: string;
  score: number | null;
  band: string | null;
  temperature: string | null;
  created_at: string;
  completed_at: string | null;
  gaps: string[] | null;
};

export type EventLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email?: string | null;
  phone?: string | null;
};

export type EventPerson = {
  id: string;
  leadId: string;
  /** False when the lead row could not be found (deleted or not visible). */
  leadFound: boolean;
  name: string;
  business: string;
  email: string;
  phone: string;
  score: number | null;
  band: string | null;
  temperature: string | null;
  takenAt: string;
  finished: boolean;
  gaps: string[];
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export function buildEventPeople(cards: readonly EventCardRow[], leads: readonly EventLeadRow[]): EventPerson[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  return [...cards]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1))
    .map((c) => {
      const lead = byId.get(c.lead_id);
      return {
        id: c.id,
        leadId: c.lead_id,
        leadFound: !!lead,
        name: lead ? clean(`${lead.first_name ?? ""} ${lead.last_name ?? ""}`) : "",
        business: clean(lead?.business_name),
        email: clean(lead?.email),
        phone: clean(lead?.phone),
        score: c.score,
        band: c.band,
        temperature: c.temperature,
        takenAt: c.created_at,
        finished: !!c.completed_at,
        gaps: Array.isArray(c.gaps) ? c.gaps : [],
      };
    });
}

/** "Nov 15, 2026, 7:42 PM EST" in the firm's zone; UTC when the zone is not one Intl knows. */
export function takenAtText(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: tz }).format(new Date(t));
  try {
    return fmt(timeZone);
  } catch {
    return fmt("UTC");
  }
}

export const BAND_LABEL: Record<string, string> = { exposed: "Exposed", partial: "Partly protected", protected: "Protected" };
export const bandText = (band: string | null) => (band ? (BAND_LABEL[band] ?? band.charAt(0).toUpperCase() + band.slice(1)) : "—");
export const temperatureText = (t: string | null) => (t === "hot" || t === "warm" || t === "cold" ? t.charAt(0).toUpperCase() + t.slice(1) : NOT_RATED);

/** The line under the People cards: how many are shown, out of how many (and "more than" when the read hit its cap). */
export function peopleCountLine(shown: number, total: number, over: boolean): string {
  const n = (x: number) => x.toLocaleString("en-US");
  if (over) return "Showing " + n(shown) + " of more than " + n(total) + ".";
  if (total > shown) return "Showing " + n(shown) + " of " + n(total) + ".";
  return n(total) + (total === 1 ? " person." : " people.");
}
