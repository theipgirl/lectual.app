import type { AcceptedFeeRow, TrackerFeeRow } from "./fees-cells";

/**
 * The two optional fee reads of the weekly review (owner only). Each takes the caller's SCOPED client as a parameter and never
 * creates or imports one: `loadReview` passes the one it already holds, so RLS on the active firm is what bounds every row.
 * Nothing here touches the service role.
 *
 * Both are chunked like the other reads in `load.ts` and paged; a read cut short (an error, or the page budget running out)
 * REJECTS, so the caller draws "Couldn't load" and names "fees": a capped page must never pass for the whole ledger.
 */

/** Ids per `in(...)` list, pages of rows, and the page budget. The same numbers `load.ts` uses for its other reads. */
export const FEES_CHUNK = 80;
export const FEES_PAGE = 1000;
export const FEES_MAX_PAGES = 10;

/** What the fee reads need of a database client: a query builder that answers like the generated one. */
type Q = PromiseLike<{ data: unknown[] | null; error: unknown }> & {
  eq(column: string, value: string): Q;
  in(column: string, values: readonly string[]): Q;
  order(column: string): Q;
  range(from: number, to: number): Q;
};
export type FeeReadClient = { from(table: string): { select(columns: string): Q } };

/** The proposal select: ids, the accept time and the two quote totals by JSON path. No content, client name or email, selection or whole snapshot. */
export const PROPOSAL_FEE_SELECT = "id, family_id, version, lead_id, matter_id, accepted_at, legal:accepted_snapshot->quote->legal_total_cents, gov:accepted_snapshot->quote->gov_total_cents";
/** The ledger select: the matter, when the row was written and three payload fields by path. Never the whole payload. */
export const TRACKER_FEE_SELECT = "matter_id, created_at, kind:payload->>kind, total:payload->>total, due:payload->>due_date";

function chunksOf<T>(items: readonly T[], size = FEES_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < FEES_MAX_PAGES; i++) {
    const { data, error } = await page(i * FEES_PAGE, i * FEES_PAGE + FEES_PAGE - 1);
    if (error) throw new Error("fee read failed");
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < FEES_PAGE) return all;
  }
  throw new Error("fee read exceeded its page budget");
}

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  return (await Promise.all(chunksOf(ids).map(read))).flat();
}

/** ACCEPTED proposals filed on the given matters or leads (the matter's lead included by the caller's id list). */
export async function readAcceptedProposalFees(db: unknown, matterIds: readonly string[], leadIds: readonly string[]): Promise<AcceptedFeeRow[]> {
  const raw = db as FeeReadClient;
  const read = (column: "matter_id" | "lead_id") => (chunk: string[]) =>
    pages<AcceptedFeeRow>((from, to) => raw.from("client_proposal").select(PROPOSAL_FEE_SELECT).eq("status", "accepted").in(column, chunk).order("id").range(from, to));
  const [m, l] = await Promise.all([inChunks(matterIds, read("matter_id")), inChunks(leadIds, read("lead_id"))]);
  return [...m, ...l];
}

/** The tracker import's fee rows (`payload->>source = tracker-import`) of the given matters. */
export async function readTrackerFees(db: unknown, matterIds: readonly string[]): Promise<TrackerFeeRow[]> {
  const raw = db as FeeReadClient;
  return inChunks(matterIds, (chunk) =>
    pages<TrackerFeeRow>((from, to) => raw.from("crm_activity").select(TRACKER_FEE_SELECT).eq("payload->>source", "tracker-import").in("matter_id", chunk).order("id").range(from, to)),
  );
}

export type FeeReads = {
  acceptedProposalFees: typeof readAcceptedProposalFees;
  trackerFees: typeof readTrackerFees;
};

export const DEFAULT_FEE_READS: FeeReads = { acceptedProposalFees: readAcceptedProposalFees, trackerFees: readTrackerFees };
