/**
 * The calendar's key.
 *
 * A month grid compresses each day to a few glyphs, which only works if the
 * glyphs are spelled out somewhere on the same screen. Two axes are legended
 * separately because they mean different things:
 *
 *   SOURCE  ● a deadline or hearing the firm owes · a task ◆ an external
 *           (Outlook) event. The `◆` is deliberately distinct and is never
 *           counted as a deadline: an external event is context, not an
 *           obligation, and letting a lunch appointment wear the same mark as
 *           a court date is the confusion this dashboard exists to remove.
 *
 *   URGENCY the three bands, each with its written label. Optional, since the
 *           deadline list beside the grid already states them.
 */

import { allBands } from "@/lib/deadlines/urgency";
import { urgencyTokens } from "@/components/UrgencyBadge";

export type CalendarLegendProps = {
  /** Adds the overdue / this week / later swatches. */
  showUrgency?: boolean;
  className?: string;
};

const SOURCE_KEYS = [
  { marker: "●", label: "deadline", color: "var(--ink-2)" },
  { marker: "◆", label: "external", color: "var(--neutral)" },
  { marker: "·", label: "task", color: "var(--neutral)" },
] as const;

export function CalendarLegend({ showUrgency = false, className }: CalendarLegendProps) {
  return (
    <div
      className={[
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--muted)]",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {SOURCE_KEYS.map((key) => (
        <span key={key.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ color: key.color }}>
            {key.marker}
          </span>
          {key.label}
        </span>
      ))}

      {showUrgency
        ? allBands().map((band) => (
            <span key={band.band} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ background: urgencyTokens(band.band).ink }}
              />
              <span style={{ color: urgencyTokens(band.band).ink }}>{band.label}</span>
            </span>
          ))
        : null}
    </div>
  );
}

export default CalendarLegend;
