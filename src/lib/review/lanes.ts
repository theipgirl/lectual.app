import type { BucketKey, ReviewBuckets, ReviewRow } from "./buckets";

/**
 * The board, from the buckets. Pure.
 *
 * Lanes are people. A row's lane is its next-step assignee, else the matter's (or lead's) assignee,
 * else "Unassigned". Lane order: owners first, then the rest alphabetically, Unassigned last.
 * Inside a lane two lists, "Our move" and "Waiting on client" (`placeOnBoard`). "Waiting on the
 * USPTO" and "On track" are the collapsed lists under the board (`offBoard`).
 */

export type LaneMember = { userId: string; name: string; role: string };

/** The flagged buckets, in the order "Our move" lists them. */
export const BOARD_COLUMNS = ["overdue", "week", "needs", "quiet"] as const satisfies readonly BucketKey[];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const UNASSIGNED_LANE = "Unassigned";

export type Lane = {
  /** The member's user id, or null for the Unassigned lane. */
  userId: string | null;
  name: string;
  /** Overdue, due this week, needs a next step, quiet, then on-track rows that wait on us or on an approval. */
  our: ReviewRow[];
  /** We sent last: the ball is with the client. Longest since our last follow-up first. */
  client: ReviewRow[];
  count: number;
};

export function laneOf(row: ReviewRow): string | null {
  return row.nextStep?.assigneeId ?? row.assignedTo ?? null;
}

const FLAGGED: ReadonlySet<BucketKey> = new Set(BOARD_COLUMNS);

/**
 * Which list of a lane a row is on, or null when it stays off the board (waiting on the USPTO, or on track with nothing
 * waiting on us). Waiting on the client wins over every bucket; a flagged bucket, or a row waiting on us or an approval, is "our" move.
 */
export function placeOnBoard(row: ReviewRow, bucket: BucketKey): "our" | "client" | null {
  if (row.waiting === "client") return "client";
  if (FLAGGED.has(bucket)) return "our";
  if (bucket === "track" && (row.waiting === "us" || row.waiting === "approval")) return "our";
  return null;
}

function compareLanes(a: { userId: string | null; name: string; owner: boolean }, b: { userId: string | null; name: string; owner: boolean }): number {
  if ((a.userId === null) !== (b.userId === null)) return a.userId === null ? 1 : -1;
  if (a.owner !== b.owner) return a.owner ? -1 : 1;
  return a.name.localeCompare(b.name, "en");
}

/** The lanes that hold at least one card, in lane order. An id that is no longer a member reads "Teammate". */
export function boardLanes(buckets: ReviewBuckets, members: readonly LaneMember[]): Lane[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const lanes = new Map<string | null, Lane>();
  for (const bucket of [...BOARD_COLUMNS, "track"] as const) {
    for (const row of buckets.sections[bucket]) {
      const where = placeOnBoard(row, bucket);
      if (!where) continue;
      const id = laneOf(row);
      let lane = lanes.get(id);
      if (!lane) {
        lane = { userId: id, name: id ? byId.get(id)?.name ?? "Teammate" : UNASSIGNED_LANE, our: [], client: [], count: 0 };
        lanes.set(id, lane);
      }
      lane[where].push(row);
      lane.count += 1;
    }
  }
  // Longest without a follow-up first; none recorded is the most neglected.
  for (const lane of lanes.values()) {
    lane.client.sort((a, b) => (a.lastOutbound ?? "").localeCompare(b.lastOutbound ?? "") || a.client.localeCompare(b.client, "en") || a.key.localeCompare(b.key));
  }
  return [...lanes.values()].sort((a, b) =>
    compareLanes(
      { userId: a.userId, name: a.name, owner: a.userId ? byId.get(a.userId)?.role === "owner" : false },
      { userId: b.userId, name: b.name, owner: b.userId ? byId.get(b.userId)?.role === "owner" : false },
    ),
  );
}

/** The two collapsed lists under the board: waiting on the USPTO, and on-track rows nothing is waiting on us for. */
export function offBoard(buckets: ReviewBuckets): { uspto: ReviewRow[]; track: ReviewRow[] } {
  return { uspto: buckets.sections.uspto, track: buckets.sections.track.filter((r) => placeOnBoard(r, "track") === null) };
}

export type MeetingPosition = { index: number; position: number; total: number; prev: number | null; next: number | null };

/** `i` is 1-based from the URL; it is clamped into range. An empty queue has no position. (Used by the Cards deck.) */
export function meetingPosition(total: number, i: number): MeetingPosition | null {
  if (total <= 0) return null;
  const position = Math.min(Math.max(Math.trunc(Number.isFinite(i) ? i : 1), 1), total);
  return { index: position - 1, position, total, prev: position > 1 ? position - 1 : null, next: position < total ? position + 1 : null };
}

/** The KPI strip: counts of the four attention buckets. */
export type Kpis = { overdue: number; week: number; needs: number; uspto: number };

export function kpis(buckets: ReviewBuckets): Kpis {
  return { overdue: buckets.counts.overdue, week: buckets.counts.week, needs: buckets.counts.needs, uspto: buckets.counts.uspto };
}
