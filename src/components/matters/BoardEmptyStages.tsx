"use client";

import { useState } from "react";

/**
 * The docket board's populated columns, plus ONE row that names the empty stages ("3 empty stages: A, B, C · Show", the
 * Leads page's pattern). Show swaps in the same board with the empty columns drawn after the populated ones. Both boards are
 * drawn by the server through the shared `ViewBoard` (so they look like every other Board), and both labels are built there from
 * the one `emptyStagesLabel`, so no wording lives here.
 */
export function BoardEmptyStages({
  labelHidden,
  labelShown,
  collapsed,
  expanded,
}: {
  labelHidden: string;
  labelShown: string;
  /** The board with only the columns that hold something. */
  collapsed: React.ReactNode;
  /** The same board with the empty columns after them. */
  expanded: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      {shown ? expanded : collapsed}
      <div className="lx-board-empty-row">
        <button type="button" className="lx-link" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          {shown ? labelShown : labelHidden}
        </button>
      </div>
    </div>
  );
}
