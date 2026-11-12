"use client";

import { useState } from "react";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { BOARD_COLUMN_CAP, SHOW_STEP } from "@/lib/intake/paging";
import { emptyStagesLabel, ownerDrop, stageDrop, type BoardModel } from "@/lib/intake/board-columns";
import { LEADS_SHOW_MORE, LEADS_UNKNOWN_TEAMMATE_DROP } from "@/lib/ui/words";
import IntakeCard from "./IntakeCard";

/**
 * Both boards, drawn from a `BoardModel` (the pure rules live in board-columns.ts). A column's title is its stage name in
 * full (two lines at most) with the count beside it and, under it, the "N to decide" badge. A column shows 15 cards and
 * "Show 15 more (N left)". Only stages that hold a lead are columns; the rest are named once and can be shown.
 */
export default function IntakeBoard({
  group,
  model,
  moveStages,
  members,
  now,
  pendingLeadId,
  errors,
  time,
  pendingApprovals,
  rowById,
  showEmpty,
  onToggleEmpty,
  onMoreInColumn,
  onMoveStage,
  onAssign,
  selecting,
  selectedIds,
  onToggleSelect,
}: {
  group: "stage" | "owner";
  model: BoardModel;
  moveStages: Stage[];
  members: MemberIdentity[];
  now: Date;
  pendingLeadId: string | null;
  errors: Record<string, string>;
  time: IntakeTime | null;
  pendingApprovals?: LeadPendingApprovals;
  rowById: (id: string) => IntakeRow | undefined;
  showEmpty: boolean;
  onToggleEmpty: () => void;
  onMoreInColumn: (key: string) => void;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (leadId: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const emptyCount = model.empty.length;

  function drop(leadId: string, column: BoardModel["columns"][number]) {
    const row = rowById(leadId);
    if (!row) return;
    if (column.drop.kind === "stage") {
      if (stageDrop(column.drop.stageId, row.lead) === "move") onMoveStage(leadId, column.drop.stageId);
    } else {
      const verdict = ownerDrop(column.drop, row.lead);
      if (verdict === "refuse") setRefused(LEADS_UNKNOWN_TEAMMATE_DROP);
      else if (verdict === "assign") onAssign(leadId, column.drop.key);
    }
  }

  return (
    <div className="ix-boardwrap">
      {refused && (
        <p role="status" className="ix-bulk-note" style={{ margin: "0 0 6px" }}>
          {refused}
        </p>
      )}
      <div className="ix-board">
        {model.columns.map((column) => (
          <section
            key={column.key}
            className="ix-col"
            data-over={over === column.key ? "" : undefined}
            aria-label={`${column.label}, ${column.count} leads`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(column.key);
            }}
            onDragLeave={() => setOver((k) => (k === column.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              setRefused(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) drop(id, column);
            }}
          >
            <header className="ix-col-head">
              <div className="ix-col-title">
                <span className="ix-col-name" title={column.label}>
                  {column.label}
                </span>
                <span className="ix-col-count">{column.count}</span>
              </div>
              {group === "owner" && column.load && <span className="ix-sub">{column.load}</span>}
              {column.undecided > 0 && (
                <span className="ix-col-badge" data-decision-count={column.undecided} title={`${column.undecided} here need a stage decision`}>
                  {`${column.undecided} to decide`}
                </span>
              )}
            </header>
            {column.shown.map((row) => (
              <IntakeCard
                key={row.lead.id}
                row={row}
                stages={moveStages}
                members={members}
                now={now}
                pending={pendingLeadId === row.lead.id}
                error={errors[row.lead.id] || undefined}
                time={time}
                pendingApprovals={pendingApprovals}
                onMoveStage={onMoveStage}
                onAssign={onAssign}
                selecting={selecting}
                selected={selectedIds.has(row.lead.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
            {column.shown.length === 0 && <p className="ix-empty-stage">Nothing here</p>}
            {column.left > 0 && (
              <button type="button" className="ix-more" onClick={() => onMoreInColumn(column.key)}>
                {LEADS_SHOW_MORE(Math.min(BOARD_COLUMN_CAP, column.left), column.left)}
              </button>
            )}
          </section>
        ))}
      </div>
      {group === "stage" && (emptyCount > 0 || showEmpty) && (
        <div className="ix-empty-stages">
          <button type="button" className="lp-link-button" aria-expanded={showEmpty} onClick={onToggleEmpty}>
            {emptyStagesLabel(showEmpty ? model.columns.filter((c) => c.count === 0).length : emptyCount, showEmpty)}
          </button>
        </div>
      )}
    </div>
  );
}

export { SHOW_STEP };
