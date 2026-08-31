import { matterIsStale, type MatterWaitingOn } from "./stage-rules";

/**
 * Pure docket-board arithmetic: column ordering, grouping, stale counts, and
 * the stage filter's catalog. Ported from
 * lectual/src/lib/matters/board.ts.
 *
 * No database, no `server-only`, no `next/headers` — it imports only the
 * (already pure) stage rules, so a client component can import it directly.
 *
 * Two design decisions are encoded here.
 *
 * 1. The 42-column problem. A firm's docket has ~42 stages; rendering one
 *    column each turns the board into a horizontal scroll of mostly-empty
 *    lanes. `buildBoard` renders a column only for stages where work is in
 *    motion (`is_open`) and folds every terminal stage into ONE trailing
 *    "Closed" group that still groups its cards by stage underneath.
 *
 * 2. `unstaged` is a REQUIRED field of the return type, and grouping keys on
 *    `matter.stage_id` rather than on an embedded `matter.stage`, so a matter
 *    pointing at a stage the caller cannot see still lands somewhere instead
 *    of being dropped on the floor. This is not a nicety: 22 of Tracy's 34
 *    live litigation matters carry `stage_id IS NULL`. An optional field
 *    invites a renderer to skip it, and skipping it silently deletes 65% of
 *    her live caseload from the screen. The conservation test in
 *    tests/board.test.ts is what keeps that true.
 */

/** The little of a stage the board reads. */
export type BoardStage = {
  id: string;
  code: string;
  label: string;
  order_index: number;
  /** false for terminal stages — they fold into the single "Closed" group. */
  is_open: boolean;
  waiting_on?: MatterWaitingOn | null;
};

/** The little of a matter the board reads. */
export type BoardMatter = {
  /** Null for an unplaced matter. Never a reason to drop it. */
  stage_id: string | null;
  stage_entered_at?: string | null;
  /** The resolved stage, when the caller has one. Used only for staleness. */
  stage?: { waiting_on?: MatterWaitingOn | null } | null;
};

export type BoardColumn<S extends BoardStage = BoardStage, M extends BoardMatter = BoardMatter> = {
  stage: S;
  matters: M[];
  /** How many of `matters` are past their stall threshold. */
  stale: number;
};

export type MatterBoard<S extends BoardStage = BoardStage, M extends BoardMatter = BoardMatter> = {
  /** Matters on a live stage — one column each, in order_index order. */
  open: BoardColumn<S, M>[];
  /** Terminal stages, grouped under a single "Closed" column. */
  closed: BoardColumn<S, M>[];
  /**
   * Matters carrying no stage_id, or pointing at a stage not in `stages` —
   * shown, never dropped. Required, never optional.
   */
  unstaged: M[];
  /** Total matters across `closed`, so callers need not re-sum. */
  closedCount: number;
};

/** Pure — sorts stages by order_index without mutating the input. */
export function sortStagesByOrder<S extends BoardStage>(stages: S[]): S[] {
  return [...stages].sort((a, b) => a.order_index - b.order_index);
}

/** Pure — how many of these matters are past their stall threshold. */
export function countStale<M extends BoardMatter>(matters: M[], now?: Date): number {
  return matters.filter((m) =>
    matterIsStale(
      { stage_entered_at: m.stage_entered_at ?? null, waiting_on: m.stage?.waiting_on ?? null },
      now,
    ),
  ).length;
}

/**
 * Pure — buckets matters into the board's columns.
 *
 * Every input matter appears in exactly one of `open[].matters`,
 * `closed[].matters`, or `unstaged`. Nothing is filtered, deduped or
 * discarded; see the conservation test.
 */
export function buildBoard<S extends BoardStage, M extends BoardMatter>(
  stages: S[],
  matters: M[],
  now?: Date,
): MatterBoard<S, M> {
  const ordered = sortStagesByOrder(stages);
  const byStage = new Map<string, M[]>();
  const unstaged: M[] = [];

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

  const column = (stage: S): BoardColumn<S, M> => {
    const own = byStage.get(stage.id) ?? [];
    return { stage, matters: own, stale: countStale(own, now) };
  };

  const open = ordered.filter((s) => s.is_open).map(column);
  // Terminal stages only appear under "Closed" when they actually hold
  // something — an empty Abandoned lane is noise, whereas an empty *live*
  // column is information (that step of the docket is clear).
  const closed = ordered
    .filter((s) => !s.is_open)
    .map(column)
    .filter((c) => c.matters.length > 0);
  const closedCount = closed.reduce((n, c) => n + c.matters.length, 0);

  return { open, closed, unstaged, closedCount };
}

/** Pure — every matter the board is holding, in board order. Unstaged first. */
export function boardMatters<S extends BoardStage, M extends BoardMatter>(
  board: MatterBoard<S, M>,
): M[] {
  return [
    ...board.unstaged,
    ...board.open.flatMap((c) => c.matters),
    ...board.closed.flatMap((c) => c.matters),
  ];
}

/**
 * Pure — the total the board is accounting for. Equal, always, to the length
 * of the array handed to `buildBoard`.
 */
export function boardMatterCount<S extends BoardStage, M extends BoardMatter>(
  board: MatterBoard<S, M>,
): number {
  const open = board.open.reduce((n, c) => n + c.matters.length, 0);
  return open + board.closedCount + board.unstaged.length;
}

/**
 * Pure — the stages the filter pills offer: those that currently hold at
 * least one matter, in board order. A firm has ~42 stages and typically uses
 * ~20 of them, so offering all 42 would bury the ones with work behind empty
 * filters. The unplaced lane is not a stage and is never in this catalog; it
 * is pinned by the renderer instead.
 */
export function stageFilterCatalog<S extends BoardStage, M extends BoardMatter>(
  stages: S[],
  matters: M[],
): BoardColumn<S, M>[] {
  const board = buildBoard(stages, matters);
  return [...board.open, ...board.closed].filter((c) => c.matters.length > 0);
}

/**
 * Pure — filters to a single stage `code`. A falsy code, or "all", is a no-op.
 * Keys on the stage catalog rather than an embedded `stage`, so it agrees with
 * `buildBoard` about which matters are on which stage.
 */
export function filterByStageCode<S extends BoardStage, M extends BoardMatter>(
  stages: S[],
  matters: M[],
  code?: string | null,
): M[] {
  if (!code || code === "all") return matters;
  const ids = new Set(stages.filter((s) => s.code === code).map((s) => s.id));
  if (ids.size === 0) return [];
  return matters.filter((m) => m.stage_id !== null && ids.has(m.stage_id));
}
