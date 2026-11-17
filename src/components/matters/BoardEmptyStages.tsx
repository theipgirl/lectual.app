"use client";

import { useState } from "react";

/**
 * The docket board's populated columns, plus ONE row that names the empty stages ("3 empty stages: A, B, C · Show", the
 * Leads page's pattern). Show draws the empty columns after the populated ones. Both labels are built on the server from
 * the one `emptyStagesLabel`, so no wording lives here.
 */
export function BoardEmptyStages({
  labelHidden,
  labelShown,
  empty,
  children,
}: {
  labelHidden: string;
  labelShown: string;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div className="lx-board" role="region" aria-label="Docket board">
        {children}
        {shown && empty}
      </div>
      <div className="lx-board-empty-row">
        <button type="button" className="lx-link" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          {shown ? labelShown : labelHidden}
        </button>
      </div>
    </div>
  );
}
