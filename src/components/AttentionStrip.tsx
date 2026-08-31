/**
 * AttentionStrip — the four counters that sit under the board.
 *
 * These are the four ways work goes quiet at this firm and stops earning:
 *
 *   Demands waiting     a settlement demand that has not gone out. At ~20% of a
 *                       ~$10k settlement this is roughly $2k per case sitting
 *                       still, and it is the most common stall in the practice.
 *   Unconfirmed dates   deadlines carrying `attorney_confirmed = false` — dates
 *                       nobody has yet stood behind. The count is the queue.
 *   Stalled cases       matters past their stall threshold (see
 *                       `@/lib/board/stage-rules`) — silence, not an event.
 *   Consults not conv.  consultations that did not become matters, counted
 *                       because a practice that only counts wins never learns
 *                       why it lost.
 *
 * EVERY COUNTER LINKS SOMEWHERE. A number with no destination is a fact she can
 * do nothing with; each tile is the entry point to the list behind it, and
 * `href` is therefore required rather than optional.
 *
 * ALL FOUR ALWAYS RENDER, INCLUDING AT ZERO. "Zero demands waiting" is a real
 * and reassuring answer; a tile that disappeared at zero would be
 * indistinguishable from a count that failed to load. For the same reason a
 * count that was not supplied (`undefined`) renders as an em dash and says
 * "count unavailable" to a screen reader — it never renders as `0`.
 *
 * Presentational: counts arrive as props, nothing here queries.
 */

import Link from "next/link";

export type AttentionCounter = {
  /** The number. `undefined` means "not counted", NOT zero — see above. */
  count?: number;
  /** Where the tile goes. Required: a counter with no list behind it is noise. */
  href: string;
  /** Optional one-liner under the label, e.g. "oldest waiting 18 days". */
  hint?: string;
};

export type AttentionStripProps = {
  demandsWaiting: AttentionCounter;
  unconfirmedDates: AttentionCounter;
  stalledCases: AttentionCounter;
  consultsNotConverted: AttentionCounter;
  /** Accessible name for the strip's landmark. */
  label?: string;
  className?: string;
};

type TileSpec = {
  key: keyof Omit<AttentionStripProps, "label" | "className">;
  label: string;
  /** Read out with the count; says what the number actually measures. */
  description: string;
};

/**
 * A registry, like the practice tabs: the strip is rendered by mapping this
 * array, so its order and wording are data rather than markup.
 */
const TILES: readonly TileSpec[] = [
  {
    key: "demandsWaiting",
    label: "Demands waiting",
    description: "Cases waiting on a settlement demand to go out.",
  },
  {
    key: "unconfirmedDates",
    label: "Unconfirmed dates",
    description: "Deadlines no attorney has confirmed yet.",
  },
  {
    key: "stalledCases",
    label: "Stalled cases",
    description: "Matters sitting in one stage past their stall threshold.",
  },
  {
    key: "consultsNotConverted",
    label: "Consults not converted",
    description: "Consultations that did not become matters.",
  },
] as const;

export function AttentionStrip({
  label = "Needs attention",
  className,
  ...counters
}: AttentionStripProps) {
  return (
    <nav
      aria-label={label}
      className={[
        "grid grid-cols-2 gap-2 sm:grid-cols-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {TILES.map((tile) => {
        const counter = counters[tile.key];
        const known = typeof counter.count === "number";
        // Zero is drawn quietly and non-zero in full ink, but the label is
        // always the same words — the number is never carried by colour alone.
        const numberClass = known && counter.count === 0 ? "text-muted" : "text-ink";

        return (
          <Link
            key={tile.key}
            href={counter.href}
            className={[
              "flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2.5",
              "shadow-[var(--shadow)] outline-offset-2 print:shadow-none",
              "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent",
            ].join(" ")}
          >
            <span
              className={[
                "font-mono text-2xl font-semibold leading-8 tabular-nums",
                numberClass,
              ].join(" ")}
            >
              {known ? (
                counter.count
              ) : (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">count unavailable</span>
                </>
              )}
            </span>
            <span className="text-[13px] font-semibold leading-4 text-ink-2">
              {tile.label}
            </span>
            <span className="text-[11px] leading-4 text-muted">
              {counter.hint ?? tile.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export default AttentionStrip;
