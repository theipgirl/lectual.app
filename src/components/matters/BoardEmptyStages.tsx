"use client";

import { useState } from "react";

/**
 * The docket board, plus ONE row that names the empty stages ("3 empty stages: A, B, C · Show", the Leads page's pattern). The server
 * draws the board ONCE through the shared `ViewBoard`, with the empty columns last and marked `data-empty-stage`; Show only flips a
 * flag that the page's CSS reads, so the board is sent once, not twice. Both labels are built on the server from the one
 * `emptyStagesLabel`, so no wording lives here.
 */
export function BoardEmptyStages({ labelHidden, labelShown, board }: { labelHidden: string; labelShown: string; board: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="lx-empty-stages" data-shown={shown ? "true" : "false"}>
      {board}
      <div className="lx-board-empty-row">
        <button type="button" className="lx-link" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          {shown ? labelShown : labelHidden}
        </button>
      </div>
    </div>
  );
}
