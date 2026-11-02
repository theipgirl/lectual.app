import { BUCKET_KEYS, type BucketKey, type ReviewBuckets, type ReviewRow } from "./buckets";

/**
 * The board, the meeting walk-through and the by-stage view, from the SAME buckets. Pure.
 *
 * Lanes are people. A row's lane is its next-step assignee, else the matter's (or lead's) assignee,
 * else "Unassigned". Lane order: owners first, then the rest alphabetically, Unassigned last. Only
 * the four flagged columns are on the board; "Waiting on the USPTO" and "On track" are counted
 * below it.
 */

export type LaneMember = { userId: string; name: string; role: string };

export const BOARD_COLUMNS = ["overdue", "week", "needs", "quiet"] as const satisfies readonly BucketKey[];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const UNASSIGNED_LANE = "Unassigned";

export type Lane = {
  /** The member's user id, or null for the Unassigned lane. */
  userId: string | null;
  name: string;
  columns: Record<BoardColumn, ReviewRow[]>;
  count: number;
};

export function laneOf(row: ReviewRow): string | null {
  return row.nextStep?.assigneeId ?? row.assignedTo ?? null;
}

function compareLanes(a: { userId: string | null; name: string; owner: boolean }, b: { userId: string | null; name: string; owner: boolean }): number {
  if ((a.userId === null) !== (b.userId === null)) return a.userId === null ? 1 : -1;
  if (a.owner !== b.owner) return a.owner ? -1 : 1;
  return a.name.localeCompare(b.name, "en");
}

/** The lanes that hold at least one flagged card, in lane order. An id that is no longer a member reads "Teammate". */
export function boardLanes(buckets: ReviewBuckets, members: readonly LaneMember[]): Lane[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const lanes = new Map<string | null, Lane>();
  for (const column of BOARD_COLUMNS) {
    for (const row of buckets.sections[column]) {
      const id = laneOf(row);
      let lane = lanes.get(id);
      if (!lane) {
        lane = {
          userId: id,
          name: id ? byId.get(id)?.name ?? "Teammate" : UNASSIGNED_LANE,
          columns: { overdue: [], week: [], needs: [], quiet: [] },
          count: 0,
        };
        lanes.set(id, lane);
      }
      lane.columns[column].push(row);
      lane.count += 1;
    }
  }
  return [...lanes.values()].sort((a, b) =>
    compareLanes(
      { userId: a.userId, name: a.name, owner: a.userId ? byId.get(a.userId)?.role === "owner" : false },
      { userId: b.userId, name: b.name, owner: b.userId ? byId.get(b.userId)?.role === "owner" : false },
    ),
  );
}

/** Rows that need a person, in board order: lane by lane, then column left to right. */
export function meetingQueue(buckets: ReviewBuckets, members: readonly LaneMember[]): ReviewRow[] {
  return boardLanes(buckets, members).flatMap((lane) => BOARD_COLUMNS.flatMap((c) => lane.columns[c]));
}

export type MeetingPosition = { index: number; position: number; total: number; prev: number | null; next: number | null };

/** `i` is 1-based from the URL; it is clamped into range. An empty queue has no position. */
export function meetingPosition(total: number, i: number): MeetingPosition | null {
  if (total <= 0) return null;
  const position = Math.min(Math.max(Math.trunc(Number.isFinite(i) ? i : 1), 1), total);
  return { index: position - 1, position, total, prev: position > 1 ? position - 1 : null, next: position < total ? position + 1 : null };
}

export function beyondBoard(buckets: ReviewBuckets): { uspto: number; track: number } {
  return { uspto: buckets.counts.uspto, track: buckets.counts.track };
}

export type StageGroup = { key: string; label: string; kind: "matter" | "lead"; rows: ReviewRow[]; flagged: number };

const FLAGGED: ReadonlySet<BucketKey> = new Set(BOARD_COLUMNS);

/** Rows grouped by stage in pipeline order (leads' stages, then the docket), flagged rows first in each group. */
export function stageGroups(buckets: ReviewBuckets): StageGroup[] {
  const groups = new Map<string, StageGroup & { order: number }>();
  const rank = new Map<string, number>();
  for (const key of BUCKET_KEYS) {
    buckets.sections[key].forEach((row, n) => rank.set(row.key, BUCKET_KEYS.indexOf(key) * 100_000 + n));
    for (const row of buckets.sections[key]) {
      const label = row.stageLabel ?? "No stage";
      const gk = `${row.kind}|${label}`;
      let g = groups.get(gk);
      if (!g) {
        g = { key: gk, label, kind: row.kind, rows: [], flagged: 0, order: row.stageOrder ?? Number.POSITIVE_INFINITY };
        groups.set(gk, g);
      }
      g.rows.push(row);
      if (FLAGGED.has(key)) g.flagged += 1;
    }
  }
  const out = [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "en") || a.kind.localeCompare(b.kind));
  for (const g of out) {
    // Flagged first: board columns in order (overdue, week, needs, quiet), then the waiting ones. Within one, bucket order.
    g.rows.sort((x, y) => (rank.get(x.key) ?? 0) - (rank.get(y.key) ?? 0));
  }
  return out.map((g) => ({ key: g.key, label: g.label, kind: g.kind, rows: g.rows, flagged: g.flagged }));
}

/** The KPI strip. A tile whose source failed is `null` (drawn as a dash and "Couldn't load"), never 0. */
export type Kpis = {
  overdue: number;
  week: number;
  needs: number;
  uspto: number;
  approval: number | null;
};

export function kpis(buckets: ReviewBuckets, rows: readonly ReviewRow[], approvalsKnown: boolean): Kpis {
  return {
    overdue: buckets.counts.overdue,
    week: buckets.counts.week,
    needs: buckets.counts.needs,
    uspto: buckets.counts.uspto,
    approval: approvalsKnown ? rows.filter((r) => r.waiting === "approval").length : null,
  };
}
