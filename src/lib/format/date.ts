/**
 * The one date formatter this app renders docket dates through.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY DATE CARRIES ITS WEEKDAY
 *
 * "9/2" is not a date an attorney can act on. It has to be read, converted and
 * held in the head before it means anything, and the thing it usually has to
 * be converted into is a DAY OF THE WEEK — because that is how a working week
 * is planned and how a court calendar is actually kept. Tracy asked for this
 * explicitly (Aug 25: "actual calendar view requested", with day-of-week
 * context); the miss that this dashboard exists to prevent was a pretrial
 * conference on a day she did not know she had.
 *
 * So `formatDocketDate` always renders the weekday: `Tue 2 Sep`. There is no
 * option to turn it off and no second numeric formatter for "compact" places.
 * If a layout is too tight for a weekday, the layout is wrong. A bare `9/2` is
 * also ambiguous outside the US, and this docket's dates get read by process
 * servers and referral partners as well as by the firm.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CIVIL DATES ARE NOT INSTANTS
 *
 * `crm_matter_deadline.due_date` is a Postgres `date` — a civil date with no
 * time of day and no zone. Formatting it by building a `Date` in local time
 * ("2026-09-02" parsed on a server in UTC, rendered in Florida) shifts it a day
 * either side of midnight, which on this product means a deadline shown on the
 * wrong day. Every civil date here is therefore anchored at UTC midnight and
 * formatted with `timeZone: "UTC"`, so the string that goes in is the date that
 * comes out, always.
 *
 * True instants (`next_hearing_at`, `due_at`) are a different animal: they are
 * converted to the COURT's civil date first (see `courtCivilDate`), never the
 * server's or the reader's. Hearing times themselves are formatted by
 * `@/lib/court-time`, which names the zone in its output.
 *
 * Pure module: no DB access and no server imports, so client components and
 * server components share exactly one implementation.
 */

import { COURT_TIME_ZONE } from "@/lib/court-time";

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A civil date anchored at UTC midnight, or null if it is not one. */
function civilInstant(date: string): Date | null {
  const match = CIVIL_DATE.exec(date);
  if (!match) return null;
  const [, y, m, d] = match;
  const probe = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(probe.getTime())) return null;
  // Rejects 2026-02-30, which `Date.parse` would happily roll into March.
  if (
    probe.getUTCFullYear() !== Number(y) ||
    probe.getUTCMonth() !== Number(m) - 1 ||
    probe.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return probe;
}

/** True for a syntactically valid, real civil date (`YYYY-MM-DD`). */
export function isCivilDate(value: unknown): value is string {
  return typeof value === "string" && civilInstant(value) !== null;
}

/**
 * The abbreviations are spelled out here rather than left to `Intl`, which is
 * not stable enough for a docket: `en-GB` abbreviates September as "Sept" and
 * `en-US` as "Sep", and which one a given runtime produces depends on its ICU
 * version. A date that renders one way on the server and another in the
 * browser is a hydration mismatch; a date whose format shifts under a Node
 * upgrade is a screenshot in a client walkthrough that no longer matches. Three
 * letters, fixed, everywhere.
 */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * A docket date, always with its weekday: `Tue 2 Sep`.
 *
 * Takes a civil date string (`YYYY-MM-DD`) — the shape a Postgres `date`
 * column comes back in. Anything that is not one returns an em dash rather
 * than throwing or inventing a date: a malformed row should show as missing on
 * the screen, not take the screen down, and must never quietly render as
 * today.
 */
export function formatDocketDate(date: string | null | undefined): string {
  if (!date) return "—";
  const instant = civilInstant(date);
  if (!instant) return "—";
  return `${WEEKDAY_SHORT[instant.getUTCDay()]} ${instant.getUTCDate()} ${
    MONTH_SHORT[instant.getUTCMonth()]
  }`;
}

/**
 * The same date with its year — `Tue 2 Sep 2026`. For anything that can point
 * outside the current year: a six-year trademark maintenance mark, a lapsed
 * appeal window from last season, a printed agenda.
 */
export function formatDocketDateWithYear(date: string | null | undefined): string {
  if (!date) return "—";
  const instant = civilInstant(date);
  if (!instant) return "—";
  return `${formatDocketDate(date)} ${instant.getUTCFullYear()}`;
}

/** The full weekday name of a civil date — "Tuesday". For prose and a11y text. */
export function docketWeekday(date: string | null | undefined): string | null {
  if (!date) return null;
  const instant = civilInstant(date);
  if (!instant) return null;
  return WEEKDAY_FULL[instant.getUTCDay()];
}

/**
 * The court-time civil date of a true instant.
 *
 * `next_hearing_at` and `due_at` are `timestamptz`. Which DAY they land on is a
 * question with a different answer in every zone, and the only answer that
 * matters here is the court's: a 9:00pm-Eastern instant is the 2nd in Florida
 * and the 3rd in UTC, and the calendar must show it on the day the court will
 * call it. `en-CA` formats as `YYYY-MM-DD`, the same shape the civil-date
 * columns arrive in.
 */
export function courtCivilDate(instant: string | Date | null | undefined): string | null {
  if (!instant) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COURT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const COURT_TIME_OF_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: COURT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * A true instant, rendered the way this app renders every other date: with its
 * weekday, on the court's day, at the court's wall clock, zone named —
 * `Tue 25 Aug 2026 · 10:00 AM EDT`.
 *
 * `formatCourtDateTime` in `@/lib/court-time` renders the same instant WITHOUT
 * a weekday ("Aug 25, 2026, 10:00 AM EDT"). That module is mirrored verbatim
 * from the main repo and stays as it is, but its output is not what a docket
 * date looks like here: the whole rule this app holds is that a date is read as
 * a day of the week, and a hearing is the last date on the screen that should
 * be exempt from it. So every user-visible instant goes through this function,
 * and `formatCourtDateTime` is left for round-tripping and for the main repo.
 *
 * Null for a missing or unparseable instant, so callers keep their own "—".
 */
export function formatDocketDateTime(
  instant: string | Date | null | undefined,
): string | null {
  if (!instant) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  const date = courtCivilDate(d);
  if (!date) return null;
  return `${formatDocketDateWithYear(date)} · ${COURT_TIME_OF_DAY.format(d)}`;
}

/**
 * Today as a civil date in the court's zone — the anchor every urgency
 * calculation and month grid should be handed, rather than reading the clock
 * for themselves.
 */
export function courtToday(now: Date = new Date()): string {
  return courtCivilDate(now) as string;
}
