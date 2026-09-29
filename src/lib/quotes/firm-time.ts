/**
 * The firm's calendar, for the quote engine's DISPLAY of dates.
 *
 * In `lectual` these live in `src/lib/matters/calendar-rows.ts`; this app's copy
 * of that file predates them, and the calendar module is not the quote port's
 * to edit. So the three pieces `status.ts` needs are here, pure, with the same
 * behaviour: expiry is DECIDED by comparing instants (status.ts), and only the
 * label goes through the firm's zone.
 *
 * Why a zone at all: Vercel runs UTC and the firm does not. A quote expiring at
 * 2026-09-12T02:00:00Z expires on the 11th in New York, and a helper that read
 * the server's calendar fields would tell a client the 12th.
 */

import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";

/**
 * The FALLBACK zone, used only when the firm's own zone is not known: every
 * function here takes the firm's zone (crm_org_profile.time_zone, Settings →
 * Firm profile) as its last argument. Callers read it with `getFirmTimeZone()`
 * (signed-in pages) or off the quote's own org (`/q/[token]`), never from the
 * runtime's zone and never from anything a caller sent.
 */
export const FIRM_TIME_ZONE = DEFAULT_TIME_ZONE;

const MS_PER_DAY = 86_400_000;

/** What civil date it is FOR THE FIRM at instant `d` — "2026-09-11". */
export function firmCivilDate(d: Date, tz: string = FIRM_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole days between two civil dates (to - from), timezone-free. */
export function civilDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * A `<input type="date">` value ("2026-09-30") → the instant the quote stops
 * being signable: 23:59:59 on that day IN THE FIRM'S ZONE, as ISO. Null when
 * the input is not a real calendar date.
 *
 * The source anchored this to 23:59:59 UTC, which is 7:59 PM in New York — a
 * client opening the link that evening found an expired proposal on the day
 * it was meant to be open. The offset is read for the day itself, so DST is
 * handled without a table.
 */
export function endOfFirmDay(dateInput: string, tz: string = FIRM_TIME_ZONE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utcGuess = Date.UTC(y, mo - 1, d, 23, 59, 59);
  const check = new Date(utcGuess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // What wall-clock time is `utcGuess` in the firm's zone? The difference is
  // the zone's offset on that day.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(check);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offsetMs = asIfUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}
