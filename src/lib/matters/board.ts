import type { Matter } from "./matters";
import type { MatterStage } from "./stages";
import { matterIsStale } from "./stage-rules";

/**
 * Pure docket-board arithmetic: column ordering, grouping, stale counts, and
 * the stage filter's catalog.
 *
 * Same discipline as src/lib/pipeline/board.ts — it imports only *types* from
 * its siblings plus the (already pure) stage-rules module, so it drags no
 * `getScopedClient`/`next/headers` into a client bundle and the board can
 * import it directly. It is deliberately NOT re-exported from stages.ts, which
 * IS server-only.
 *
 * The one design decision encoded here is the answer to the 42-column problem.
 * A firm's docket has ~42 stages; rendering one column each turns the board
 * into a horizontal scroll of mostly-empty lanes. `buildBoard` renders a column
 * only for stages where work is actually in motion — `is_open` stages — and
 * folds every terminal stage (`is_open: false`: Abandoned / Registered /
 * Lost-Nurture / No Longer Moving Forward) into ONE trailing "Closed" column
 * that still groups its cards by stage underneath. Nothing is hidden: every
 * matter appears in exactly one group, and matters with no stage at all get
 * their own leading group rather than silently vanishing.
 */

export type BoardColumn = {
  stage: MatterStage;
  matters: Matter[];
  /** How many of `matters` are past their stall threshold. */
  stale: number;
};

export type MatterBoard = {
  /** Matters on a live stage — one column each, in order_index order. */
  open: BoardColumn[];
  /** Terminal stages, grouped under a single "Closed" column. */
  closed: BoardColumn[];
  /** Matters carrying no stage_id — shown, never dropped. */
  unstaged: Matter[];
  closedCount: number;
};

/** Pure — sorts stages by order_index without mutating the input. */
export function sortStagesByOrder(stages: MatterStage[]): MatterStage[] {
  return [...stages].sort((a, b) => a.order_index - b.order_index);
}

/** Pure — how many of these matters are past their stall threshold. */
export function countStale(matters: Matter[], now?: Date): number {
  return matters.filter((m) =>
    matterIsStale({ stage_entered_at: m.stage_entered_at, waiting_on: m.stage?.waiting_on ?? null }, now),
  ).length;
}

/**
 * Pure — buckets matters into the board's columns.
 *
 * Grouping keys on `matter.stage_id`, not on the embedded `matter.stage`, so a
 * matter pointing at a stage the caller cannot see still lands somewhere
 * (`unstaged`) instead of being dropped on the floor.
 */
export function buildBoard(stages: MatterStage[], matters: Matter[], now?: Date): MatterBoard {
  const ordered = sortStagesByOrder(stages);
  const byStage = new Map<string, Matter[]>();
  const unstaged: Matter[] = [];

  const known = new Set(ordered.map((s) => s.id));
  for (const m of matters) {
    if (!m.stage_id || !known.has(m.stage_id)) {
      unstaged.push(m);
      continue;
    }
    const bucket = byStage.get(m.stage_id);
    if (bucket) bucket.push(m);
    else byStage.set(m.stage_id, [m]);
  }

  const column = (stage: MatterStage): BoardColumn => {
    const own = byStage.get(stage.id) ?? [];
    return { stage, matters: own, stale: countStale(own, now) };
  };

  const open = ordered.filter((s) => s.is_open).map(column);
  // Terminal stages only appear under "Closed" when they actually hold
  // something — an empty Abandoned lane is noise, whereas an empty *live*
  // column is information (that step of the docket is clear).
  const closed = ordered.filter((s) => !s.is_open).map(column).filter((c) => c.matters.length > 0);
  const closedCount = closed.reduce((n, c) => n + c.matters.length, 0);

  return { open, closed, unstaged, closedCount };
}

/**
 * Pure — the stages the filter pills offer: those that currently hold at least
 * one matter, in board order. A firm has ~42 stages and typically uses ~20 of
 * them, so offering all 42 would bury the ones with work behind empty filters.
 */
export function stageFilterCatalog(stages: MatterStage[], matters: Matter[]): BoardColumn[] {
  const board = buildBoard(stages, matters);
  return [...board.open, ...board.closed].filter((c) => c.matters.length > 0);
}

/** Pure — filters to a single stage `code`. A falsy/"all" code is a no-op. */
export function filterByStageCode(matters: Matter[], code?: string | null): Matter[] {
  if (!code || code === "all") return matters;
  return matters.filter((m) => m.stage?.code === code);
}
