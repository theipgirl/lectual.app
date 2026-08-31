/**
 * The month grid — pure civil-date geometry, no clock and no data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GRID AS WELL AS A LIST
 *
 * The ranked deadline list answers "what is on fire". The month grid answers a
 * different question the list cannot: "what does my month look like" — the
 * day-of-week context Tracy asked for by name, where three hearings landing in
 * one week is a shape you see before you read a single row. Neither substitutes
 * for the other, so both render, side by side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO CONSTRAINTS THIS MODULE HOLDS
 *
 * NO CLOCK AT MODULE SCOPE. `today` is a parameter, never `Date.now()` read
 * during import. A module-scope clock is frozen at whatever moment the server
 * bundle was first evaluated, so a long-running process would keep highlighting
 * a stale "today" — and it makes every test either untestable or dependent on
 * the day it is run on.
 *
 * CIVIL DATES ONLY. Every day in the grid is a `YYYY-MM-DD` string built with
 * UTC arithmetic. Nothing here constructs a local-time `Date` from a date
 * string, so no timezone and no DST transition can shift a day into the wrong
 * cell — a grid that renders 1 Sep in the 31 Aug slot on one server and not on
 * another is exactly the kind of bug nobody reproduces.
 */

import type { CalendarRow } from "@/lib/calendar/rows";

const MS_PER_DAY = 86_400_000;

/** 0 = Sunday. The dashboard grid is Su–Sa, matching the mock in the plan. */
export type WeekStart = 0 | 1;

export type MonthDay = {
  /** Civil date, `YYYY-MM-DD`. */
  date: string;
  /** Day of month, 1–31. */
  day: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
};

export type MonthWeek = {
  /** `YYYY-MM-DD` of the week's first cell — a stable React key. */
  key: string;
  days: MonthDay[];
};

export type MonthGrid = {
  year: number;
  /** 1–12, not the 0-based nonsense `Date` uses. Off-by-one months are a bug
   * class this app cannot afford, so the boundary is explicit. */
  month: number;
  /** "September 2026". */
  label: string;
  weeks: MonthWeek[];
  /** First and last civil date IN the grid, leading/trailing days included —
   * the exact window a data read should cover so no visible cell is empty for
   * want of a query bound. */
  start: string;
  end: string;
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** Column headings, aligned to the same `weekStart` the grid was built with. */
export const WEEKDAY_HEADINGS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export function weekdayHeadings(weekStart: WeekStart = 0): string[] {
  return [...WEEKDAY_HEADINGS.slice(weekStart), ...WEEKDAY_HEADINGS.slice(0, weekStart)];
}

function civil(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Adds whole days to a civil date. Timezone-free and DST-proof. */
export function addDays(date: string, days: number): string {
  return civil(utcMs(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_PER_DAY);
}

/** `{ year, month }` of a civil date, month 1–12. */
export function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** "September 2026" for a year + 1–12 month. */
export function monthLabel(year: number, month: number): string {
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** The month before — the `‹` control. Wraps the year correctly. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** The month after — the `›` control. */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Days in a month, 1–12. Leap years included, because `Date.UTC` knows. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The grid for one month: whole weeks, with the adjacent months' days flagged
 * `inMonth: false` rather than blanked.
 *
 * Rendering the leading and trailing days rather than empty cells is
 * deliberate: a deadline on Mon 31 Aug is still a deadline when you are looking
 * at September, and an empty corner where it should be reads as "nothing
 * there". They are visually recessed by the caller, never omitted.
 *
 * `today` is a civil date the caller supplies. Pass `courtToday()` — today in
 * the court's zone — so the highlight is on the day the attorney is having,
 * not the day UTC is having.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  today: string,
  options: { weekStart?: WeekStart } = {},
): MonthGrid {
  const weekStart = options.weekStart ?? 0;
  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const lead = (new Date(firstOfMonth).getUTCDay() - weekStart + 7) % 7;
  const gridStart = firstOfMonth - lead * MS_PER_DAY;

  const total = lead + daysInMonth(year, month);
  const weekCount = Math.ceil(total / 7);

  const weeks: MonthWeek[] = [];
  for (let w = 0; w < weekCount; w += 1) {
    const days: MonthDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const ms = gridStart + (w * 7 + d) * MS_PER_DAY;
      const date = civil(ms);
      const weekday = new Date(ms).getUTCDay();
      days.push({
        date,
        day: new Date(ms).getUTCDate(),
        weekday,
        inMonth: Number(date.slice(0, 4)) === year && Number(date.slice(5, 7)) === month,
        isToday: date === today,
        isWeekend: weekday === 0 || weekday === 6,
      });
    }
    weeks.push({ key: days[0].date, days });
  }

  return {
    year,
    month,
    label: monthLabel(year, month),
    weeks,
    start: weeks[0].days[0].date,
    end: weeks[weeks.length - 1].days[6].date,
  };
}

/** The grid containing a given civil date — "the month `date` is in". */
export function monthGridFor(
  date: string,
  today: string,
  options: { weekStart?: WeekStart } = {},
): MonthGrid {
  const { year, month } = monthOf(date);
  return buildMonthGrid(year, month, today, options);
}

// ── Bucketing rows onto days ─────────────────────────────────────────────────

/**
 * Rows keyed by civil date. Built once per render rather than filtering the
 * whole row list inside each of ~42 cells, which is quadratic and shows on a
 * docket this size.
 */
export function bucketRowsByDate(
  rows: readonly CalendarRow[],
): Record<string, CalendarRow[]> {
  const buckets: Record<string, CalendarRow[]> = {};
  for (const row of rows) {
    (buckets[row.date] ??= []).push(row);
  }
  return buckets;
}

export type MonthDayWithRows = MonthDay & { rows: CalendarRow[] };
export type MonthWeekWithRows = { key: string; days: MonthDayWithRows[] };
export type MonthGridWithRows = Omit<MonthGrid, "weeks"> & { weeks: MonthWeekWithRows[] };

/**
 * The grid with each day's rows attached — including the leading and trailing
 * days, which carry real rows and must show their markers. Row order inside a
 * day is whatever `buildCalendar` sorted it into; this does not re-sort.
 */
export function attachRows(
  grid: MonthGrid,
  rows: readonly CalendarRow[],
): MonthGridWithRows {
  const buckets = bucketRowsByDate(rows);
  return {
    ...grid,
    weeks: grid.weeks.map((week) => ({
      key: week.key,
      days: week.days.map((day) => ({ ...day, rows: buckets[day.date] ?? [] })),
    })),
  };
}

/** Every row falling inside a grid's visible window, in order. */
export function rowsInGrid(grid: MonthGrid, rows: readonly CalendarRow[]): CalendarRow[] {
  return rows.filter((r) => r.date >= grid.start && r.date <= grid.end);
}
