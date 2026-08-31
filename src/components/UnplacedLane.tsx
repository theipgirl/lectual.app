/**
 * UnplacedLane — the pinned first lane of every board.
 *
 * THIS COMPONENT IS A DEFENCE, NOT A FEATURE
 * ------------------------------------------
 * 22 of this firm's 34 live litigation matters carry `stage_id IS NULL`. They
 * are deliberately unplaced — real, open, deadline-bearing cases awaiting the
 * attorney's judgment about where they sit. Any board that keys on `stage_id`
 * drops 65% of her live litigation off the screen without an error, and a
 * screen that silently omits two thirds of the caseload is exactly the shape of
 * the failure that cost her a pretrial conference.
 *
 * So three things are true of this component and are not configurable:
 *
 * 1. IT ALWAYS RENDERS. There is no `hideWhenEmpty`, and the zero case is an
 *    explicit, worded state ("Nothing waiting to be placed") rather than a
 *    missing lane. A lane that disappears at zero teaches the eye not to look
 *    for it, and the day it matters most is the day it comes back.
 * 2. IT IS FIRST. `buildBoard` returns `unstaged` as a required field and never
 *    as a stage, so the page pins this lane ahead of `board.open`. It is not
 *    sorted with the stages and cannot be sorted behind them.
 * 3. IT LOOKS LIKE AN OPEN QUESTION. The pinned variant, the "needs placing"
 *    kicker and the instruction line mark it as a holding area with work owed,
 *    not as a stage matters can live on indefinitely. Optionally each card
 *    carries its own "place" control via `renderAction`.
 *
 * Presentational only: placing a matter on a stage is a write owned by the page.
 */

import type { ReactNode } from "react";

import { EmptyState } from "@/components/EmptyState";
import { MatterCard, type MatterCardItem } from "@/components/MatterCard";
import { LaneShell } from "@/components/StageLane";

export type UnplacedLaneProps = {
  /** `MatterBoard.unstaged`. May be empty; the lane renders regardless. */
  matters: readonly MatterCardItem[];
  /** Civil date the cards band their deadlines against. */
  today?: string;
  /**
   * Per-card control — typically a "Place on a stage" button or link. Rendered
   * inside the card, beside the case number.
   */
  renderAction?: (matter: MatterCardItem) => ReactNode;
  /** Lane-level control, e.g. "Place all…". Sits under the header. */
  action?: ReactNode;
  className?: string;
};

export function UnplacedLane({
  matters,
  today,
  renderAction,
  action,
  className,
}: UnplacedLaneProps) {
  const count = matters.length;

  return (
    <LaneShell
      id="unplaced-lane"
      variant="pinned"
      eyebrow="needs placing"
      title="Unplaced"
      count={count}
      note={
        count > 0 ? (
          <>
            <strong className="font-semibold">
              {count === 1 ? "This matter has" : `These ${count} matters have`}
            </strong>{" "}
            no stage yet, so {count === 1 ? "it does" : "they do"} not appear on any lane
            below. Deadlines on {count === 1 ? "it" : "them"} still run. Give each one a
            stage to move it onto the board.
          </>
        ) : null
      }
      className={className}
    >
      {action ? <div>{action}</div> : null}

      {count === 0 ? (
        <EmptyState
          compact
          title="Nothing waiting to be placed"
          description="Every matter in this practice sits on a stage. This lane stays here so an unplaced matter can never appear without being noticed."
        />
      ) : (
        matters.map((matter) => (
          <MatterCard
            key={matter.id}
            matter={matter}
            today={today}
            action={renderAction?.(matter)}
          />
        ))
      )}
    </LaneShell>
  );
}

export default UnplacedLane;
