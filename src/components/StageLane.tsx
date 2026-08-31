/**
 * StageLane — one column of the practice board, plus the shell both lanes share.
 *
 * A lane is a labelled stack of matter cards with a count in its header. The
 * count is rendered from `matters.length` here rather than accepted as a prop,
 * so a lane can never advertise a number different from the number of cards
 * underneath it.
 *
 * AN EMPTY LIVE LANE STILL RENDERS.
 * `buildBoard` gives a column to every OPEN stage whether or not it holds
 * anything (only terminal stages are dropped when empty), and this component
 * honours that: an empty "Answer" lane is the information "that step of the
 * docket is clear", said in words by `EmptyState`. A lane that vanished when it
 * emptied would be indistinguishable from a lane that failed to load, and would
 * make the board's shape change under her every time a matter moved.
 *
 * The stale count in the header comes from `buildBoard`'s `stale` field — the
 * lane does no staleness arithmetic itself. It is shown only when non-zero and
 * is worded, never a bare coloured number.
 *
 * Presentational only. Lanes render what they are handed; moving a matter
 * between stages is a write that belongs to the page.
 */

import type { ReactNode } from "react";

import { EmptyState } from "@/components/EmptyState";
import { MatterCard, type MatterCardItem } from "@/components/MatterCard";

export type LaneShellProps = {
  /** The lane's heading — a stage label, or "Unplaced". */
  title: ReactNode;
  /** Small kicker above the title — the stage code, or "needs placing". */
  eyebrow?: ReactNode;
  /** Number shown in the header. Callers pass the real card count. */
  count: number;
  /** One line under the header, e.g. the unplaced lane's instruction. */
  note?: ReactNode;
  /** Header-right slot — a stale count, a filter, a link. */
  meta?: ReactNode;
  /**
   * `pinned` gives the lane a heavier border and a tinted header. Used by the
   * unplaced lane so it reads as a holding area rather than as a stage.
   */
  variant?: "stage" | "pinned";
  children: ReactNode;
  className?: string;
  id?: string;
};

/**
 * The chrome every lane shares. Exported so `UnplacedLane` is visibly the same
 * component family as `StageLane` rather than a lookalike that could drift.
 */
export function LaneShell({
  title,
  eyebrow,
  count,
  note,
  meta,
  variant = "stage",
  children,
  className,
  id,
}: LaneShellProps) {
  const pinned = variant === "pinned";
  const headingId = id ? `${id}-title` : undefined;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={[
        "flex min-w-0 flex-col rounded-md border bg-surface-2",
        pinned ? "border-soon-border bg-soon-bg" : "border-border",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {eyebrow ? (
            <span className="font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.09em] text-muted">
              {eyebrow}
            </span>
          ) : null}
          <h3
            id={headingId}
            className={[
              "truncate text-[13px] font-semibold leading-5",
              pinned ? "text-soon" : "text-ink",
            ].join(" ")}
          >
            {title}
          </h3>
        </div>
        <span className="ml-auto shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-ink-2">
          {count}
          <span className="sr-only"> matters</span>
        </span>
        {meta ? <div className="w-full text-[11px] text-muted">{meta}</div> : null}
      </header>

      {note ? (
        <p className="border-b border-border px-3 py-1.5 text-[11px] leading-4 text-ink-2">
          {note}
        </p>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

export type StageLaneProps = {
  /** The stage this lane represents. `code` is shown as the lane's kicker. */
  stage: { id?: string; code: string; label: string };
  matters: readonly MatterCardItem[];
  /** `BoardColumn.stale` — how many of these are past their stall threshold. */
  stale?: number;
  /** Civil date the cards band their deadlines against. */
  today?: string;
  className?: string;
};

export function StageLane({ stage, matters, stale = 0, today, className }: StageLaneProps) {
  return (
    <LaneShell
      id={`stage-lane-${stage.code.toLowerCase()}`}
      eyebrow={stage.code}
      title={stage.label}
      count={matters.length}
      meta={
        stale > 0 ? (
          <span className="text-soon">
            {stale} {stale === 1 ? "matter has" : "matters have"} stalled here
          </span>
        ) : null
      }
      className={className}
    >
      {matters.length === 0 ? (
        <EmptyState
          compact
          title="Nothing at this stage"
          description="This step of the docket is clear right now."
        />
      ) : (
        matters.map((matter) => (
          <MatterCard key={matter.id} matter={matter} today={today} />
        ))
      )}
    </LaneShell>
  );
}

export default StageLane;
