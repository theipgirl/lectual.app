"use client";

import { useState } from "react";
import type { Stage } from "@/lib/pipeline";
import { BULK_MOVE_MAX } from "@/lib/pipeline/bulk-move";
import { stageCodeFor, stageLabelFor } from "@/lib/intake/views";

/**
 * "Move to..." for the cards ticked on the board. It only chooses: the move itself is `bulkMoveStageAction`, one
 * `moveLeadStage` per lead. A stage that opens a matter is not offered (the action refuses it too), and more than
 * BULK_MOVE_MAX cards cannot be moved in one go. Nothing here sends anything.
 */
export default function BulkMoveBar({
  selectedCount,
  shownCount,
  stages,
  pending,
  message,
  onSelectShown,
  onClear,
  onMove,
}: {
  selectedCount: number;
  /** Cards on the board right now (after filters). */
  shownCount: number;
  /** The stages a lead can be moved to in bulk. Any `won` stage is dropped here as well. */
  stages: Stage[];
  pending: boolean;
  message: { tone: "ok" | "warn" | "error"; text: string } | null;
  onSelectShown: () => void;
  onClear: () => void;
  onMove: (stageId: string) => void;
}) {
  const choices = stages.filter((stage) => stage.category !== "won");
  const [stageId, setStageId] = useState("");
  const tooMany = selectedCount > BULK_MOVE_MAX;
  const canMove = selectedCount > 0 && stageId !== "" && !tooMany && !pending;

  return (
    <div className="intake-bulk" role="group" aria-label="Move several leads at once" data-bulk-bar>
      {selectedCount === 0 ? (
        <>
          <span>Tick cards to move several at once.</span>
          {shownCount > 0 && (
            <button type="button" className="lx-btn" onClick={onSelectShown}>
              {`Select the ${Math.min(shownCount, BULK_MOVE_MAX)} shown`}
            </button>
          )}
        </>
      ) : (
        <>
          <strong data-bulk-count>{`${selectedCount} selected`}</strong>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Move to</span>
            <select value={stageId} onChange={(event) => setStageId(event.target.value)} aria-label="Move the selected leads to this stage">
              <option value="">Choose a stage</option>
              {choices.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {`${stageCodeFor(stage)} · ${stageLabelFor(stage)}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="lx-btn lx-btn-pri" disabled={!canMove} onClick={() => onMove(stageId)}>
            {pending ? "Moving…" : "Move"}
          </button>
          <button type="button" className="lx-btn" onClick={onClear} disabled={pending}>
            Clear
          </button>
          {tooMany && <span role="status">{`Select at most ${BULK_MOVE_MAX} at a time.`}</span>}
        </>
      )}
      {message && (
        <span role={message.tone === "error" ? "alert" : "status"} data-bulk-message={message.tone}>
          {message.text}
        </span>
      )}
    </div>
  );
}
