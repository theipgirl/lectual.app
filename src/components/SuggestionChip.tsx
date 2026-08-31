"use client";

/**
 * SuggestionChip — how a computed date looks before anybody has docketed it.
 *
 * THE LINE THIS COMPONENT DRAWS
 * -----------------------------
 * The answer clock in `@/lib/deadlines/answer-clock` counts 20 days from a
 * service date so the attorney stops typing dates into timeanddate.com. What it
 * produces is arithmetic, not a determination: which rule governs, whether the
 * period is calendar or business days, and whether a Saturday landing moves are
 * all legal questions this product does not answer. A suggestion is therefore
 * NOT a deadline until a human clicks, and this chip is the visual statement of
 * that fact.
 *
 * It is built to be impossible to mistake for a docket entry:
 *
 *   · DASHED border and a flat, tinted ground — every real docket row in this
 *     app has a solid border and an urgency-coloured left rule.
 *   · IT CARRIES NO URGENCY COLOUR. Not overdue-red, not soon-amber, not
 *     later-blue — those three colours mean "the firm is on the hook for this
 *     date", and a suggestion is precisely a date the firm is not yet on the
 *     hook for. Borrowing the palette would be the whole bug.
 *   · THE WORDS ARE ALWAYS THERE. `SUGGESTION_NOTICE` — "Suggested — not on the
 *     docket…" — is rendered unconditionally, is not a prop, and cannot be
 *     shortened away by a caller. Colour and border are the fast signal; the
 *     sentence is the one that survives greyscale printing, a colour-blind
 *     reader and a screen reader.
 *   · THE BASIS IS SHOWN, not hidden behind a tooltip, so the reader can see
 *     where the number came from before deciding anything.
 *
 * A chip is never counted in the deadline hero and never drawn on the calendar.
 * That is enforced by the callers (nothing here emits a calendar row), and by
 * the `kind: 'suggestion'` discriminant on the value it renders.
 *
 * `onDocket` is what turns it into a real row — a write the PAGE owns. When it
 * fires, the deadline is written `source='manual'` with the basis stored in
 * `calculation_basis` and `attorney_confirmed=false`. Never `'calculated'`:
 * a calculated source would assert that the software determined the date.
 *
 * Presentational: it renders a value and reports clicks. No fetching, no state.
 */

import type { ReactNode } from "react";

import { SUGGESTION_NOTICE } from "@/lib/deadlines/answer-clock";
import { docketWeekday, formatDocketDateWithYear } from "@/lib/format/date";

export type SuggestionChipProps = {
  /** What the date would be — "Answer due", "Default may be sought". */
  label: string;
  /** The suggested civil date, `YYYY-MM-DD`. */
  date: string;
  /**
   * Where the number came from, in plain words — pass `AnswerClock.basis`.
   * Shown, not tucked into a title attribute.
   */
  basis?: string;
  /**
   * A caution to surface above the actions — e.g. `weekendCaution()`, which
   * states that the date lands on a weekend WITHOUT proposing another one.
   */
  caution?: string | null;
  /** Docket it. Omit to render an inert, read-only chip. */
  onDocket?: () => void;
  /** Discard the suggestion for now. */
  onDismiss?: () => void;
  docketLabel?: string;
  dismissLabel?: string;
  /** Disables both buttons while a write is in flight. */
  pending?: boolean;
  /**
   * Replaces the built-in buttons entirely — for a `<form action={…}>` server
   * action. The notice and the dashed treatment are unaffected.
   */
  actions?: ReactNode;
  className?: string;
};

export function SuggestionChip({
  label,
  date,
  basis,
  caution,
  onDocket,
  onDismiss,
  docketLabel = "Docket this date",
  dismissLabel = "Dismiss",
  pending = false,
  actions,
  className,
}: SuggestionChipProps) {
  const weekday = docketWeekday(date);
  const hasBuiltInActions = Boolean(onDocket || onDismiss);

  return (
    <div
      className={[
        // Dashed, neutral, and visibly not a docket row.
        "flex min-w-0 flex-col gap-2 rounded-sm border border-dashed border-border-strong",
        "bg-surface-2 px-3 py-2.5",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.09em] text-muted">
        Suggestion
      </p>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-semibold leading-5 text-ink-2">{label}</span>
        <time
          dateTime={date}
          className="font-mono text-sm font-semibold tabular-nums text-ink"
        >
          {formatDocketDateWithYear(date)}
        </time>
        {/* The weekday in full, spelled out. The app does not roll a date off a
            weekend — it shows the day and hands the decision back. */}
        {weekday ? <span className="text-xs text-muted">({weekday})</span> : null}
      </div>

      {/* Not optional, not abbreviated, not a tooltip. */}
      <p className="text-[11px] font-semibold leading-4 text-ink-2">{SUGGESTION_NOTICE}</p>

      {basis ? <p className="max-w-prose text-[11px] leading-4 text-muted">{basis}</p> : null}

      {caution ? (
        <p
          role="status"
          className="rounded-sm border border-soon-border bg-soon-bg px-2 py-1.5 text-[11px] leading-4 text-soon"
        >
          <span aria-hidden="true">⚠ </span>
          {caution}
        </p>
      ) : null}

      {actions ? (
        <div className="flex flex-wrap gap-2">{actions}</div>
      ) : hasBuiltInActions ? (
        <div className="flex flex-wrap gap-2">
          {onDocket ? (
            <button
              type="button"
              onClick={onDocket}
              disabled={pending}
              className={[
                "rounded-sm bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink",
                "outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
                "disabled:opacity-60",
              ].join(" ")}
            >
              {docketLabel}
              <span className="sr-only"> — {label}, {formatDocketDateWithYear(date)}</span>
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={pending}
              className={[
                "rounded-sm border border-border-strong px-2.5 py-1 text-xs font-semibold text-ink-2",
                "outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
                "disabled:opacity-60",
              ].join(" ")}
            >
              {dismissLabel}
              <span className="sr-only"> — {label}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default SuggestionChip;
