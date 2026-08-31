/**
 * Urgency banding for docket dates — pure, civil-date arithmetic only.
 *
 * A docket deadline is a CIVIL date (`YYYY-MM-DD`, no time of day). It is not
 * an instant, so nothing in this module ever builds a `Date` out of a due date
 * and compares timestamps: that would silently import whatever timezone the
 * renderer happened to run in, and would flip a date's band by a day depending
 * on whether the page rendered from a server in UTC or a laptop in Florida.
 * Instead both sides are reduced to a civil date string and subtracted at UTC
 * midnight, which makes the result timezone-free and DST-proof: seven calendar
 * days is seven days across a DST boundary, not 6.958.
 *
 * THE RULE THAT MATTERS MOST HERE
 * ------------------------------
 * An open deadline whose due date has passed is `overdue`, always, no matter
 * how far past it is. There is no "stale", no "archived", no quiet bucket a
 * blown date can fall into. Two of the deadlines on this docket are
 * intentionally-overdue lapsed appeal windows, left open on purpose so they
 * keep rendering red at the top of the screen. A horizon filter anywhere in
 * this app bounds the FAR end only — never `due_date >= today`.
 *
 * Colour is never the only signal. Every band carries a text label, exported
 * here so the badge, the screen-reader text and the section heading all read
 * from one place.
 */

/** Bands, most urgent first. Order is meaningful — it drives sorting. */
export const URGENCY_BANDS = ["overdue", "soon", "later"] as const;

export type UrgencyBand = (typeof URGENCY_BANDS)[number];

/**
 * `soon` is "due within a week", inclusive at both ends: today (0 days) and
 * exactly seven days out are both `soon`. Day 8 is `later`.
 */
export const SOON_HORIZON_DAYS = 7;

/**
 * The docket's civil-date timezone. Every matter here is a Florida state-court
 * matter, so "today" means today in Florida — not today in UTC, which starts
 * at 8pm the previous evening and would mark a deadline overdue while the
 * attorney is still in the office on its due date.
 */
export const DOCKET_TIME_ZONE = "America/New_York";

export type BandDescriptor = {
  band: UrgencyBand;
  /** Section heading / badge text. Never rely on colour alone. */
  label: string;
  /** Longer form for tooltips and screen readers. */
  description: string;
};

const BAND_DESCRIPTORS: Record<UrgencyBand, BandDescriptor> = {
  overdue: {
    band: "overdue",
    label: "Overdue",
    description: "Past its due date and still open, however long ago.",
  },
  soon: {
    band: "soon",
    label: "This week",
    description: `Due today or within the next ${SOON_HORIZON_DAYS} days.`,
  },
  later: {
    band: "later",
    label: "Later",
    description: `Due more than ${SOON_HORIZON_DAYS} days out.`,
  },
};

/** The label/description for a band. */
export function bandDescriptor(band: UrgencyBand): BandDescriptor {
  return BAND_DESCRIPTORS[band];
}

/** Text label for a band — the non-colour signal. */
export function urgencyLabel(band: UrgencyBand): string {
  return BAND_DESCRIPTORS[band].label;
}

/** Every band in order, for rendering empty sections as well as full ones. */
export function allBands(): readonly BandDescriptor[] {
  return URGENCY_BANDS.map(bandDescriptor);
}

// ── Civil-date primitives ────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically valid, real civil date (rejects 2026-02-30). */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !CIVIL_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Today as a civil date in the docket's timezone. `en-CA` formats as
 * `YYYY-MM-DD`, which is exactly the shape Postgres `date` columns come back in.
 */
export function civilToday(now: Date = new Date(), timeZone: string = DOCKET_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whole days from `from` to `to` (`to - from`), both civil dates. Negative when
 * `to` is earlier. Anchored at UTC midnight on both sides so the count is
 * timezone-free and unaffected by daylight saving.
 */
export function civilDaysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/** Days until a due date from today. Negative when past due. */
export function daysUntil(dueDate: string, today: string = civilToday()): number {
  return civilDaysBetween(today, dueDate);
}

/** Adds exact days to a civil date, returning a civil date. */
export function addCivilDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** The weekday name of a civil date. Read at UTC midnight, so no zone shift. */
export function civilWeekday(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

// ── Banding ──────────────────────────────────────────────────────────────────

/**
 * The band a civil due date falls in, relative to `today`.
 *
 * Past → `overdue` unconditionally. There is deliberately no cutoff beyond
 * which a missed date stops being overdue.
 */
export function urgencyBand(dueDate: string, today: string = civilToday()): UrgencyBand {
  const days = civilDaysBetween(today, dueDate);
  if (days < 0) return "overdue";
  if (days <= SOON_HORIZON_DAYS) return "soon";
  return "later";
}

/** The minimum shape this module needs off a docket row. */
export type BandableDeadline = {
  due_date: string;
  status?: string | null;
};

/**
 * The band for a docket row. Status is not consulted: a row's band is a
 * property of its date. Callers decide which statuses they render (the hero
 * shows `status = 'open'`); nothing here can quietly reclassify a lapsed
 * appeal window out of `overdue`.
 */
export function deadlineBand<T extends BandableDeadline>(
  deadline: T,
  today: string = civilToday(),
): UrgencyBand {
  return urgencyBand(deadline.due_date, today);
}

/** True when an open deadline's date has passed. */
export function isOverdue(dueDate: string, today: string = civilToday()): boolean {
  return urgencyBand(dueDate, today) === "overdue";
}

/**
 * Sorts by band (overdue first), then by date ascending — the oldest blown
 * date at the very top, because it is the one most likely to be forgotten.
 * Returns a new array; the input is not mutated.
 */
export function sortByUrgency<T extends BandableDeadline>(
  deadlines: readonly T[],
  today: string = civilToday(),
): T[] {
  return [...deadlines].sort((a, b) => {
    const bandDelta =
      URGENCY_BANDS.indexOf(deadlineBand(a, today)) - URGENCY_BANDS.indexOf(deadlineBand(b, today));
    if (bandDelta !== 0) return bandDelta;
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  });
}

export type BandedGroup<T> = BandDescriptor & { deadlines: T[] };

/**
 * Groups into all three bands, in order, keeping empty bands in the result so
 * a section can render its zero state instead of vanishing.
 */
export function groupByUrgency<T extends BandableDeadline>(
  deadlines: readonly T[],
  today: string = civilToday(),
): BandedGroup<T>[] {
  const sorted = sortByUrgency(deadlines, today);
  return URGENCY_BANDS.map((band) => ({
    ...bandDescriptor(band),
    deadlines: sorted.filter((d) => deadlineBand(d, today) === band),
  }));
}

/** Per-band counts plus the total — the "7 open · 2 overdue" strip. */
export function countByUrgency<T extends BandableDeadline>(
  deadlines: readonly T[],
  today: string = civilToday(),
): Record<UrgencyBand, number> & { total: number } {
  const counts = { overdue: 0, soon: 0, later: 0, total: deadlines.length };
  for (const d of deadlines) counts[deadlineBand(d, today)] += 1;
  return counts;
}

/**
 * Human phrasing for how far off a date is, always paired with the band label
 * rather than replacing it. "12 days overdue" reads as an alarm; "in 12 days"
 * does not — the distinction is the whole point.
 */
export function urgencyPhrase(dueDate: string, today: string = civilToday()): string {
  const days = civilDaysBetween(today, dueDate);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${-days} days overdue`;
  return `due in ${days} days`;
}
