/**
 * UP NEXT — the linear 14-day reading of the calendar.
 *
 * The ranked deadline list answers "what is on fire"; the month grid answers
 * "what does my month look like"; this answers "what happens next, in order",
 * which is the question you ask on a Monday morning. It is the same merged
 * rows the grid renders, sliced by `upNext` from the calendar engine — not a
 * second query and not a second merge, so the two surfaces cannot drift.
 *
 * Bounds the FAR end only. `upNext` starts at `today`, which means overdue
 * rows are not here — they are in the deadline list directly above, which is
 * the one place in this app a date is allowed to be filtered out of a view,
 * and only because another view on the same screen is still showing it. The
 * empty state says so out loud rather than reading as "nothing is due".
 *
 * External (Outlook) rows appear with a `◆` and no urgency colour: context,
 * never an obligation, and never counted anywhere.
 *
 * Presentational only. Rows and `today` arrive as props.
 */

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { urgencyTokens } from "@/components/UrgencyBadge";
import { upNext, type CalendarRow, type CalendarRowKind } from "@/lib/calendar/rows";
import { courtToday, docketWeekday, formatDocketDate } from "@/lib/format/date";
import { urgencyLabel } from "@/lib/deadlines/urgency";

export type UpNextProps = {
  /** The full merged rows. Slicing to the window happens here. */
  rows: readonly CalendarRow[];
  /** Civil date the window starts at. Defaults to today in court time. */
  today?: string;
  /** Window length in days, inclusive. */
  days?: number;
  /** When set, the list shows only this day — the calendar's day selection. */
  selectedDate?: string | null;
  /** Rendered as a "show all 14 days" control when a day is selected. */
  onClearSelection?: () => void;
  className?: string;
};

/**
 * The markers from the design: ● an obligation, ◆ somebody else's calendar
 * showing through, · one of the firm's own work items. Each is paired with a
 * word in the row's screen-reader text, so the glyph is never load-bearing.
 */
const KIND_MARKER: Record<CalendarRowKind, string> = {
  deadline: "●",
  hearing: "●",
  task: "·",
  external: "◆",
};

const KIND_NOUN: Record<CalendarRowKind, string> = {
  deadline: "Deadline",
  hearing: "Hearing",
  task: "Task",
  external: "Calendar event",
};

export function UpNext({
  rows,
  today = courtToday(),
  days = 14,
  selectedDate = null,
  onClearSelection,
  className,
}: UpNextProps) {
  const windowRows = upNext(rows, today, days);
  const visible = selectedDate
    ? windowRows.filter((row) => row.date === selectedDate)
    : windowRows;

  return (
    <Card
      eyebrow="Up next"
      title={selectedDate ? formatDocketDate(selectedDate) : `Next ${days} days`}
      meta={
        selectedDate && onClearSelection ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded-[var(--r-sm)] border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold text-[var(--ink-2)] outline-offset-2 hover:bg-[var(--surface-3)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Show all {days} days
          </button>
        ) : null
      }
      className={className}
    >
      {visible.length === 0 ? (
        <div className="grid gap-1 py-1">
          <p className="text-sm text-[var(--ink-2)]">
            {selectedDate
              ? `Nothing on ${formatDocketDate(selectedDate)}.`
              : `Nothing scheduled in the next ${days} days.`}
          </p>
          {/* Never let an empty forward window read as "nothing is due" — that
              is the exact sentence a missed pretrial hides behind. */}
          <p className="text-xs text-[var(--muted)]">
            This window looks forward only. Anything overdue is in the deadline list.
          </p>
        </div>
      ) : (
        <ul className="grid divide-y divide-[var(--border)]">
          {visible.map((row) => (
            <UpNextRow key={row.key} row={row} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpNextRow({ row }: { row: CalendarRow }) {
  const ink = row.urgency ? urgencyTokens(row.urgency).ink : "var(--neutral)";

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <time
        dateTime={row.date}
        className="w-[5.5rem] shrink-0 font-mono text-sm tabular-nums text-[var(--ink-2)]"
      >
        <span className="sr-only">{docketWeekday(row.date) ?? ""} </span>
        <span aria-hidden="true">{formatDocketDate(row.date)}</span>
      </time>

      <span
        aria-hidden="true"
        className="w-3 shrink-0 text-center text-sm leading-none"
        style={{ color: ink }}
      >
        {KIND_MARKER[row.kind]}
      </span>
      <span className="sr-only">
        {KIND_NOUN[row.kind]}
        {row.urgency ? `, ${urgencyLabel(row.urgency)}` : ""}.{" "}
      </span>

      <span className="min-w-0 flex-1 text-sm text-[var(--ink)]">
        {row.title}
        {row.time ? (
          <span className="ml-2 font-mono text-xs font-semibold text-[var(--ink-2)]">
            {row.time}
          </span>
        ) : null}
      </span>

      {row.matterNumber ? <Badge mono>{row.matterNumber}</Badge> : null}
    </li>
  );
}

export default UpNext;
