"use client";

import { useState } from "react";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { SHOW_STEP } from "@/lib/intake/paging";
import { emptyStagesLabel, ownerDrop, stageDrop, type BoardModel } from "@/lib/intake/board-columns";
import { columnEmpty, LEADS_UNKNOWN_TEAMMATE_DROP } from "@/lib/ui/words";
import { BoardColumn } from "@/components/ui/Board";
import { ShowingCount } from "@/components/ui/ShowingCount";
import IntakeCard from "./IntakeCard";
import type { DuplicateOf } from "@/lib/intake/duplicates";
import type { IntakeCardData } from "@/lib/record-card/intake-cards";
import type { Lane } from "@/lib/leads/lane";
import type { ReferralSource } from "@/lib/intake";
import { neighbours, stageMenuModel, type MenuStage } from "@/lib/stages/menu-model";
import { StageMenu } from "@/components/views/stages/StageMenu";
import { ColumnMenu } from "@/components/views/layout/ColumnMenu";
import { stageColumnKey } from "@/lib/views/layout/stage-columns";
import type { ViewKey } from "@/lib/views/layout/types";

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
  cards,
  openHrefFor,
  savedId,
  onSetLane,
  onSetSource,
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
  duplicates = {},
  movedOut,
  timeZone,
  onCompare,
  stageAdmin = null,
  layoutEdit = null,
}: {
  /**
   * Given only for an owner whose saved `leads_board` layout was read: the column menu on each STAGE column. The layout only hides a
   * stage column here (its name and place are the stage's own, changed from the stage menu), so the menu offers Hide and nothing else.
   */
  layoutEdit?: { view: ViewKey; rev: number | null } | null;
  /** The owner's stage menu (absent for everyone else): every lead stage and what each holds (null = unreadable). */
  stageAdmin?: { all: MenuStage[]; holdings: Record<string, string[]> | null; merged?: Record<string, number> | null } | null;
  group: "stage" | "owner";
  model: BoardModel;
  moveStages: Stage[];
  members: MemberIdentity[];
  now: Date;
  pendingLeadId: string | null;
  errors: Record<string, string>;
  cards?: Record<string, IntakeCardData>;
  openHrefFor?: (leadId: string) => string;
  savedId?: string | null;
  onSetLane?: (leadId: string, lane: Lane | null) => void;
  onSetSource?: (leadId: string, source: ReferralSource | null) => void;
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
  duplicates?: Record<string, DuplicateOf>;
  movedOut?: ReadonlySet<string>;
  timeZone?: string;
  onCompare?: (leadId: string, otherId: string, trigger: HTMLElement) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const emptyCount = model.empty.length;
  // The stage columns in the order drawn: Move left / right go beside the VISIBLE neighbour, so the move is seen.
  const stageOrder = group === "stage" ? model.columns.flatMap((c) => (c.drop.kind === "stage" ? [c.drop.stageId] : [])) : [];
  const menuFor = (column: BoardModel["columns"][number]) => {
    if (group !== "stage" || column.drop.kind !== "stage") return undefined;
    const stageId = column.drop.stageId;
    const stage = stageAdmin?.all.find((s) => s.id === stageId);
    const stageMenu = stageAdmin && stage ? <StageMenu model={stageMenuModel({ kind: "lead", stage, all: stageAdmin.all, ...neighbours(stageOrder, stageId), holdings: stageAdmin.holdings, merged: stageAdmin.merged ?? null })} /> : null;
    const columnMenu = layoutEdit ? <ColumnMenu view={layoutEdit.view} rev={layoutEdit.rev} columnKey={stageColumnKey(stageId)} label={column.label} kind="stage" /> : null;
    return stageMenu || columnMenu ? (
      <>
        {columnMenu}
        {stageMenu}
      </>
    ) : undefined;
  };

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
        <p role="status" className="ix-bulk-note">
          {refused}
        </p>
      )}
      <div className="lx-board ix-board">
        {model.columns.map((column) => (
          <BoardColumn
            key={column.key}
            title={column.label}
            count={column.count}
            ariaLabel={`${column.label}, ${column.count} leads`}
            data-over={over === column.key ? "" : undefined}
            note={
              <>
                {group === "owner" && column.load && <span className="ix-sub">{column.load}</span>}
                {column.undecided > 0 && (
                  <span className="lx-pill lx-pill-warn" data-decision-count={column.undecided} title={`${column.undecided} here need a stage decision`}>
                    {`${column.undecided} to decide`}
                  </span>
                )}
              </>
            }
            empty={columnEmpty("leads")}
            menu={menuFor(column)}
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
            {column.shown.map((row) => (
              <IntakeCard
                key={row.lead.id}
                row={row}
                stages={moveStages}
                members={members}
                pending={pendingLeadId === row.lead.id}
                error={errors[row.lead.id] || undefined}
                card={cards?.[row.lead.id]}
                openHref={openHrefFor?.(row.lead.id)}
                saved={savedId === row.lead.id}
                onSetLane={onSetLane}
                onSetSource={onSetSource}
                time={time}
                pendingApprovals={pendingApprovals}
                onMoveStage={onMoveStage}
                onAssign={onAssign}
                selecting={selecting}
                selected={selectedIds.has(row.lead.id)}
                onToggleSelect={onToggleSelect}
                duplicate={duplicates[row.lead.id]}
                movedOut={movedOut?.has(row.lead.id) ?? false}
                now={now}
                timeZone={timeZone}
                onCompare={onCompare}
              />
            ))}
            {column.left > 0 && (
              <li className="ix-col-more">
                <ShowingCount shown={column.shown.length} total={column.count} onMore={() => onMoreInColumn(column.key)} />
              </li>
            )}
          </BoardColumn>
        ))}
      </div>
      {group === "stage" && (emptyCount > 0 || showEmpty) && (
        <div className="ix-empty-stages">
          <button type="button" className="lx-link" aria-expanded={showEmpty} onClick={onToggleEmpty}>
            {emptyStagesLabel(showEmpty ? model.columns.filter((c) => c.count === 0).length : emptyCount, showEmpty, model.empty.map((e) => e.label))}
          </button>
        </div>
      )}
    </div>
  );
}

export { SHOW_STEP };
