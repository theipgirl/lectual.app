import type { Stage } from "@/lib/pipeline";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "./rows";
import { ownerColumns, stageLabelFor } from "./views";
import { BOARD_COLUMN_CAP, capColumn } from "./paging";
import { decisionOpen } from "./stage-decision";

/**
 * Which board columns are drawn, and what a drop does. PURE.
 *
 * Stage board: only stages that HOLD a lead in the current view are columns; the rest are named once ("N empty stages")
 * and can be shown. A card moved in this session already carries its new stage, so its column never disappears under it.
 */
export type StageCol = { stage: Stage; label: string; rows: IntakeRow[] };

export function splitStageColumns(rows: readonly IntakeRow[], stages: readonly Stage[]): { populated: StageCol[]; empty: StageCol[] } {
  const populated: StageCol[] = [];
  const empty: StageCol[] = [];
  for (const stage of inPipelineOrder([...stages])) {
    const mine = rows.filter((r) => r.lead.current_stage_id === stage.id);
    (mine.length > 0 ? populated : empty).push({ stage, label: stageLabelFor(stage), rows: mine });
  }
  return { populated, empty };
}

/**
 * The stages a lead can be moved to from a row menu or the bulk bar: the intake stages, plus the lost stages ONLY while the
 * Lost set is shown. A `won` stage is never offered (that move opens a matter).
 */
export function moveTargetStages(intake: readonly Stage[], lost: readonly Stage[], lostShown: boolean): Stage[] {
  return [...intake, ...(lostShown ? lost : [])].filter((s) => s.category !== "won");
}

/** "3 empty stages: A, B, C · Show": every empty stage is NAMED, so one like "Undecided / Questions" is findable. */
export function emptyStagesLabel(n: number, shown: boolean, names: readonly string[] = []): string {
  const list = names.length > 0 && !shown ? `: ${names.join(", ")}` : "";
  return `${n} empty ${n === 1 ? "stage" : "stages"}${list} · ${shown ? "Hide" : "Show"}`;
}

/** The owner board: a column is a real person, "Unassigned", or a teammate the directory could not name. */
export type OwnerColumnKind = { key: string | null; stray: boolean };

/**
 * What dropping a card on an owner column does: nothing when the lead is already there, nothing for a teammate we
 * cannot name (assigning to an unknown id would write a person nobody can see), otherwise assign (a null key unassigns).
 */
export function ownerDrop(column: OwnerColumnKind, lead: { assigned_to: string | null }): "assign" | "noop" | "refuse" {
  if (column.stray) return "refuse";
  if ((lead.assigned_to ?? null) === column.key) return "noop";
  return "assign";
}

/** Dropping on a stage column: nothing when the lead is already in it. */
export function stageDrop(stageId: string, lead: { current_stage_id: string }): "move" | "noop" {
  return lead.current_stage_id === stageId ? "noop" : "move";
}

export type BoardColumn = {
  key: string;
  label: string;
  /** Every lead in the column (the number in the header). */
  count: number;
  /** The cards drawn: pinned first, then up to the cap (+ what the person asked for). */
  shown: IntakeRow[];
  left: number;
  /** Leads here whose Lawmatics-import stage is undecided. */
  undecided: number;
  initials?: string;
  load?: string;
  /** The Long-Term Nurture column at the end of the stage board: drawn a little quieter. */
  quiet?: boolean;
  drop: { kind: "stage"; stageId: string } | { kind: "owner"; key: string | null; stray: boolean };
};

export type BoardModel = { columns: BoardColumn[]; empty: Array<{ key: string; label: string; stageId: string }>; renderedIds: string[] };

/**
 * The whole board as data. Stage board: populated stages (+ the empty ones when `showEmpty`, as real drop targets).
 * Owner board: Unassigned first, then every member (a person with no leads is still a place to drop a card). Each
 * column draws `BOARD_COLUMN_CAP + extra[key]` cards; `pinned` cards (moved this session) come first and never count
 * against the cap. `renderedIds` is exactly the cards drawn, which is all a bulk move may use.
 */
export function boardModel(input: {
  rows: readonly IntakeRow[];
  stages: readonly Stage[];
  members: readonly MemberIdentity[];
  group: "stage" | "owner";
  pinned: readonly string[];
  extra: Readonly<Record<string, number>>;
  showEmpty: boolean;
  /**
   * The stage board ALWAYS ends with a Long-Term Nurture column, whatever set is chosen: the leads in nurture stages (already
   * filtered and sorted by the caller) and the stage a drop lands on. Null = no such column (the owner board, the Nurture
   * set, which already draws it, or a firm with no nurture stage).
   */
  nurture?: { rows: readonly IntakeRow[]; stage: Stage } | null;
}): BoardModel {
  const { rows, group, pinned, extra } = input;
  const draw = (key: string, mine: IntakeRow[]) => {
    const capped = capColumn(mine, BOARD_COLUMN_CAP + (extra[key] ?? 0), pinned);
    return { ...capped, undecided: mine.filter((r) => decisionOpen(r.decision, r.lead.current_stage_id)).length };
  };
  const columns: BoardColumn[] = [];
  let empty: BoardModel["empty"] = [];
  if (group === "stage") {
    const nurture = input.nurture ?? null;
    const { populated, empty: none } = splitStageColumns(rows, nurture ? input.stages.filter((s) => s.category !== "nurture") : input.stages);
    for (const c of populated) columns.push({ key: c.stage.id, label: c.label, count: c.rows.length, ...draw(c.stage.id, c.rows), drop: { kind: "stage", stageId: c.stage.id } });
    if (input.showEmpty) {
      for (const c of none) columns.push({ key: c.stage.id, label: c.label, count: 0, shown: [], left: 0, undecided: 0, drop: { kind: "stage", stageId: c.stage.id } });
      const order = new Map(inPipelineOrder([...input.stages]).map((s, i) => [s.id, i]));
      columns.sort((a, b) => (a.quiet ? 1 : 0) - (b.quiet ? 1 : 0) || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    } else {
      empty = none.map((c) => ({ key: c.stage.id, label: c.label, stageId: c.stage.id }));
    }
    if (nurture) {
      const mine = [...nurture.rows];
      columns.push({ key: nurture.stage.id, label: stageLabelFor(nurture.stage), count: mine.length, ...draw(nurture.stage.id, mine), quiet: true, drop: { kind: "stage", stageId: nurture.stage.id } });
    }
  } else {
    const known = new Set(input.members.map((m) => m.userId));
    for (const c of ownerColumns([...rows], [...input.members])) {
      const stray = c.key !== null && !known.has(c.key);
      columns.push({ key: c.key ?? "unassigned", label: c.label, count: c.count, ...draw(c.key ?? "unassigned", c.rows), initials: c.initials, load: c.load, drop: { kind: "owner", key: c.key, stray } });
    }
  }
  return { columns, empty, renderedIds: columns.flatMap((c) => c.shown.map((r) => r.lead.id)) };
}
