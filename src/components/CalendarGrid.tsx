"use client";

/**
 * The month grid — "what does my month look like".
 *
 * This is the day-of-week context the attorney asked for by name. The ranked
 * deadline list beside it is ordered by urgency and is blind to the shape of
 * the month; this is the opposite reading of the same rows, where three
 * hearings landing in one week is visible as a cluster before you have read a
 * single word. Neither substitutes for the other, which is why both are on the
 * home screen.
 *
 * WHAT THIS COMPONENT WILL NOT DO
 *
 * - It does not fetch. Rows arrive already merged and deduped by
 *   `@/lib/calendar/rows`, so this grid and `UP NEXT` render the same list.
 * - It does not read the clock. `today` is a required prop — a civil date in
 *   COURT time — because a grid that asked `new Date()` for itself would
 *   highlight the day UTC is having, which after 8pm in Florida is tomorrow.
 * - It does not decide urgency. Bands come in on the rows.
 *
 * ZERO ROWS IS A FIRST-CLASS STATE. An empty month renders the full grid with
 * every day present and no markers. It must never collapse, blank, or show an
 * error: a calendar that renders as nothing looks exactly like "nothing is
 * due", and that is precisely the appearance that cost this firm a pretrial
 * conference.
 *
 * Markers are `●` obligation (coloured by the most urgent band that day), `·`
 * task, `◆` external — and every one of them is also spelled out in the day
 * button's accessible name, so the grid is readable with no colour and no
 * glyphs at all.
 */

import { useMemo, useState } from "react";

import {
  attachRows,
  buildMonthGrid,
  monthOf,
  nextMonth,
  previousMonth,
  weekdayHeadings,
  type MonthDayWithRows,
  type WeekStart,
} from "@/lib/calendar/month";
import type { CalendarRow } from "@/lib/calendar/rows";
import { URGENCY_BANDS, urgencyLabel, type UrgencyBand } from "@/lib/deadlines/urgency";
import { formatDocketDateWithYear } from "@/lib/format/date";
import { urgencyTokens } from "@/components/UrgencyBadge";

export type MonthRef = { year: number; month: number };

export type CalendarGridProps = {
  /** Civil date, today in COURT time. Marks the today cell. Required. */
  today: string;
  /** The month to show first. Defaults to the month `today` is in. */
  month?: MonthRef;
  /** Merged calendar rows. Rows outside the visible window are ignored. */
  rows?: readonly CalendarRow[];
  /** The day currently filtering `UP NEXT`, if any. */
  selectedDate?: string | null;
  /** Called with the civil date of the clicked day. */
  onSelectDay?: (date: string) => void;
  /**
   * Supply to drive the month from outside (controlled). Omit and the grid
   * keeps its own month, so it works standalone with no wiring.
   */
  onMonthChange?: (month: MonthRef) => void;
  weekStart?: WeekStart;
  className?: string;
};

const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type DayMarkers = {
  /** The most urgent band among the day's obligations, if it has any. */
  band: UrgencyBand | null;
  obligations: number;
  tasks: number;
  external: number;
};

function dayMarkers(rows: readonly CalendarRow[]): DayMarkers {
  const markers: DayMarkers = { band: null, obligations: 0, tasks: 0, external: 0 };
  for (const row of rows) {
    if (row.kind === "deadline" || row.kind === "hearing") {
      markers.obligations += 1;
      if (
        row.urgency &&
        (markers.band === null ||
          URGENCY_BANDS.indexOf(row.urgency) < URGENCY_BANDS.indexOf(markers.band))
      ) {
        markers.band = row.urgency;
      }
    } else if (row.kind === "task") {
      markers.tasks += 1;
    } else {
      markers.external += 1;
    }
  }
  return markers;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The day cell's accessible name: everything the glyphs and colours say. */
function dayLabel(day: MonthDayWithRows, markers: DayMarkers): string {
  const parts: string[] = [formatDocketDateWithYear(day.date)];
  if (day.isToday) parts.push("today");
  if (markers.obligations > 0) {
    const band = markers.band ? `, ${urgencyLabel(markers.band).toLowerCase()}` : "";
    parts.push(`${plural(markers.obligations, "deadline")}${band}`);
  }
  if (markers.tasks > 0) parts.push(plural(markers.tasks, "task"));
  if (markers.external > 0) parts.push(plural(markers.external, "external event"));
  if (markers.obligations + markers.tasks + markers.external === 0) parts.push("nothing due");
  return parts.join(", ");
}

export function CalendarGrid({
  today,
  month,
  rows = [],
  selectedDate = null,
  onSelectDay,
  onMonthChange,
  weekStart = 0,
  className,
}: CalendarGridProps) {
  const initial = month ?? monthOf(today);
  const [internalMonth, setInternalMonth] = useState<MonthRef>(initial);
  // Controlled when the caller supplies both a month and a change handler;
  // otherwise the grid owns its own navigation and works with no wiring.
  const controlled = month !== undefined && onMonthChange !== undefined;
  const view = controlled ? month : internalMonth;

  const goTo = (next: MonthRef) => {
    if (onMonthChange) onMonthChange(next);
    if (!controlled) setInternalMonth(next);
  };

  const grid = useMemo(
    () => attachRows(buildMonthGrid(view.year, view.month, today, { weekStart }), rows),
    [view.year, view.month, today, weekStart, rows],
  );

  const headings = weekdayHeadings(weekStart);
  const todayMonth = monthOf(today);
  const atToday = view.year === todayMonth.year && view.month === todayMonth.month;

  return (
    <div className={className}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2
          className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]"
          aria-live="polite"
        >
          {grid.label}
        </h2>
        <div className="flex items-center gap-1">
          <NavButton
            label="Previous month"
            glyph="‹"
            onClick={() => goTo(previousMonth(view.year, view.month))}
          />
          <button
            type="button"
            onClick={() => goTo(todayMonth)}
            disabled={atToday}
            className="rounded-[var(--r-sm)] border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold text-[var(--ink-2)] outline-offset-2 hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
          >
            Today
          </button>
          <NavButton
            label="Next month"
            glyph="›"
            onClick={() => goTo(nextMonth(view.year, view.month))}
          />
        </div>
      </header>

      <div role="grid" aria-label={`Docket calendar, ${grid.label}`}>
        <div role="row" className="grid grid-cols-7">
          {headings.map((heading, index) => {
            const full = WEEKDAY_FULL[(index + weekStart) % 7];
            return (
              <div
                key={full}
                role="columnheader"
                className="pb-1 text-center font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"
              >
                <span aria-hidden="true">{heading}</span>
                <span className="sr-only">{full}</span>
              </div>
            );
          })}
        </div>

        {grid.weeks.map((week) => (
          <div role="row" key={week.key} className="grid grid-cols-7">
            {week.days.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                selected={day.date === selectedDate}
                onSelectDay={onSelectDay}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-7 w-7 rounded-[var(--r-sm)] border border-[var(--border-strong)] text-sm leading-none text-[var(--ink-2)] outline-offset-2 hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

function DayCell({
  day,
  selected,
  onSelectDay,
}: {
  day: MonthDayWithRows;
  selected: boolean;
  onSelectDay?: (date: string) => void;
}) {
  const markers = dayMarkers(day.rows);
  const obligationInk = markers.band ? urgencyTokens(markers.band).ink : "var(--ink-2)";

  const inner = (
    <>
      <span
        className={[
          "font-mono text-xs tabular-nums",
          day.inMonth ? "text-[var(--ink)]" : "text-[var(--muted)] opacity-70",
          day.isToday ? "font-bold" : "",
        ]
          .join(" ")
          .trim()}
      >
        {day.day}
      </span>
      {/* Fixed-height marker strip so days with and without rows are the same
          size and the month keeps its shape at zero rows. */}
      <span aria-hidden="true" className="flex h-3 items-center gap-0.5 leading-none">
        {markers.obligations > 0 ? (
          <span className="text-[10px]" style={{ color: obligationInk }}>
            ●
          </span>
        ) : null}
        {markers.external > 0 ? (
          <span className="text-[10px] text-[var(--neutral)]">◆</span>
        ) : null}
        {markers.tasks > 0 ? (
          <span className="text-sm text-[var(--neutral)]">·</span>
        ) : null}
      </span>
    </>
  );

  const shell = [
    "flex min-h-12 w-full flex-col items-center justify-start gap-0.5 rounded-[var(--r-sm)] border px-1 py-1",
    day.inMonth ? "bg-[var(--surface)]" : "bg-transparent",
    day.isWeekend && day.inMonth ? "bg-[var(--surface-2)]" : "",
  ]
    .join(" ")
    .trim();

  const borderStyle = selected
    ? { borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" }
    : day.isToday
      ? { borderColor: "var(--border-strong)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }
      : { borderColor: "transparent" };

  const label = dayLabel(day, markers);

  if (!onSelectDay) {
    return (
      <div role="gridcell" className="p-0.5">
        <div className={shell} style={borderStyle} aria-label={label}>
          {day.isToday ? <span className="sr-only">Today. </span> : null}
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div role="gridcell" className="p-0.5">
      <button
        type="button"
        onClick={() => onSelectDay(day.date)}
        aria-pressed={selected}
        aria-label={label}
        className={`${shell} cursor-pointer outline-offset-1 hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
        style={borderStyle}
      >
        {inner}
      </button>
    </div>
  );
}

export default CalendarGrid;
