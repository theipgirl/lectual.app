/**
 * Live leads (M5, lectual 0107). A lead is MERGED when `crm_lead.merged_into_id` is set: it stays in the
 * database (its timeline, files, proposals and quotes stay on it) but it is no longer a lead anyone works.
 * The `crm_lead_merge_guard` trigger refuses any update to it, so every writer resolves to the keeper first or
 * skips it, and every list leaves it out.
 *
 * This file is the ONE place those rules live:
 *   - `leadRead(build)`: runs a crm_lead query. `build` gets `live` (adds `.is("merged_into_id", null)`) and
 *     `merged` (true when the 0107 columns exist, so a query may also select `merged_into_id`). A list read
 *     wraps its builder in `live(...)`.
 *   - `followMerged` / `resolveLeadId`: follow `merged_into_id` to the keeper. One hop is normal (lectual
 *     refuses a merge that would make a chain); a loop or a long chain is reported, never followed forever.
 *   - `mergedSetFor`: the keeper plus the leads merged into it, for the history reads (activity, files,
 *     proposals) that stay on the merged lead.
 *   - `foldMergedLeads` (pure): turns a list that includes merged rows into one where a merged row is read as
 *     its keeper, for matchers that should follow the pointer instead of skipping.
 *
 * BEFORE 0107 (a database without the columns): the filtered query fails with 42703 (Postgres "undefined
 * column") or PGRST204 (PostgREST "column not in the schema cache"), judged by CODE only. `leadRead` then
 * runs the same query again without the filter and remembers, for `MISSING_TTL_MS`, that the columns are
 * missing, so later reads go straight to the unfiltered form. Every lead is live there and Merge is hidden
 * (`mergeAvailable`). A result that worked is remembered for good (a column does not disappear). If the
 * unfiltered query fails with the same code too, the column was not ours: nothing is remembered and that
 * error is returned to the caller as it is.
 *
 * Nothing here logs or throws text a person reads. No service role: the caller passes its own client (the
 * scoped client on every dashboard path; the importers and agents pass their org-fenced admin client).
 */

/** The error codes that mean "this database has no merged_into_id column yet" (before lectual 0107). */
export const MERGE_COLUMN_MISSING_CODES: ReadonlySet<string> = new Set(["42703", "PGRST204"]);

export function isMergeColumnMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && MERGE_COLUMN_MISSING_CODES.has(code);
}

/** How long "the columns are missing" is believed before the filtered form is tried again. */
export const MISSING_TTL_MS = 5 * 60 * 1000;

type Support = { kind: "unknown" } | { kind: "present" } | { kind: "missing"; until: number };
let support: Support = { kind: "unknown" };

/** Test hook: forget what was learned about the columns. */
export function resetLeadMergeSupport(): void {
  support = { kind: "unknown" };
}

/** What has been learned so far (for tests and the merge screen's own probe). */
export function leadMergeSupport(now = Date.now()): "unknown" | "present" | "missing" {
  if (support.kind === "missing") return now < support.until ? "missing" : "unknown";
  return support.kind;
}

/** Applies the live filter. Typed as identity so a Supabase builder keeps its own type. */
export type LiveFilter = <Q>(query: Q) => Q;

const applyLive: LiveFilter = <Q>(query: Q): Q => (query as unknown as { is: (column: string, value: null) => Q }).is("merged_into_id", null);
const noFilter: LiveFilter = <Q>(query: Q): Q => query;

export type LeadReadKit = {
  /** Wrap a crm_lead filter builder: leaves merged leads out (a no-op before 0107). */
  live: LiveFilter;
  /** True when the 0107 columns can be named (select `merged_into_id`, filter on it). */
  merged: boolean;
};

type ResultLike = { error?: unknown };

/**
 * Runs a crm_lead read (or an update that should only touch live leads) with the merge columns when the
 * database has them, and without them when it doesn't. See the header for the rules.
 */
export async function leadRead<R extends ResultLike>(build: (kit: LeadReadKit) => PromiseLike<R>, now: () => number = Date.now): Promise<R> {
  if (leadMergeSupport(now()) === "missing") return build({ live: noFilter, merged: false });
  const first = await build({ live: applyLive, merged: true });
  if (!isMergeColumnMissing(first.error)) {
    if (!first.error) support = { kind: "present" };
    return first;
  }
  const second = await build({ live: noFilter, merged: false });
  if (isMergeColumnMissing(second.error)) {
    // The unfiltered query failed the same way: a different column is missing, not ours.
    support = { kind: "unknown" };
    return second;
  }
  support = { kind: "missing", until: now() + MISSING_TTL_MS };
  return second;
}

/** The two crm_lead columns the resolver needs. */
export type MergePointer = { id: string; merged_into_id?: string | null };

/** At most this many hops are followed (lectual refuses chains, so 1 is normal; the rest is a guard). */
export const MAX_MERGE_HOPS = 4;

export type FollowResult =
  | { status: "ok"; id: string; mergedFrom: string | null }
  | { status: "not-found" }
  | { status: "unavailable" };

/**
 * Follows `merged_into_id` from `start` to the keeper. `read` returns the row (or null when it isn't there or
 * isn't visible) and throws when the read failed. A loop, or more than `MAX_MERGE_HOPS` hops, is `unavailable`:
 * never a guess. `mergedFrom` is the id that was asked for when it was a merged lead, else null.
 */
export async function followMerged(start: string, read: (id: string) => Promise<MergePointer | null>): Promise<FollowResult> {
  const seen = new Set<string>();
  let id = start;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop += 1) {
    if (seen.has(id)) return { status: "unavailable" };
    seen.add(id);
    let row: MergePointer | null;
    try {
      row = await read(id);
    } catch {
      return { status: "unavailable" };
    }
    if (!row) return hop === 0 ? { status: "not-found" } : { status: "unavailable" };
    const next = typeof row.merged_into_id === "string" && row.merged_into_id ? row.merged_into_id : null;
    if (!next) return { status: "ok", id: row.id, mergedFrom: row.id === start ? null : start };
    id = next;
  }
  return { status: "unavailable" };
}

/** Pure: the keeper of `id` within a list already loaded (follows the pointer with the same guard). Null when it can't be told. */
export function keeperIn(id: string, rows: ReadonlyMap<string, MergePointer>): string | null {
  const seen = new Set<string>();
  let current = id;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop += 1) {
    if (seen.has(current)) return null;
    seen.add(current);
    const row = rows.get(current);
    if (!row) return null;
    const next = typeof row.merged_into_id === "string" && row.merged_into_id ? row.merged_into_id : null;
    if (!next) return row.id;
    current = next;
  }
  return null;
}

/**
 * Pure: a list that may include merged rows, read the way a matcher should see it. A live row is kept as it
 * is. A merged row becomes its keeper's row with ONLY the merged row's `email` (so mail or an invite sent to
 * the old address still finds the keeper), and nothing else of the merged row is used. A merged row whose
 * keeper isn't in the list (or that can't be resolved) is dropped. Rows that end up with the same id and the
 * same email (case-insensitive) are kept once. `merged_into_id` is removed from what comes back.
 */
export function foldMergedLeads<T extends MergePointer & { email?: string | null }>(rows: readonly T[]): Omit<T, "merged_into_id">[] {
  const byId = new Map<string, T>(rows.map((r) => [r.id, r]));
  const out: Omit<T, "merged_into_id">[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    let shaped: T;
    if (row.merged_into_id) {
      const keeperId = keeperIn(row.id, byId);
      const keeper = keeperId ? byId.get(keeperId) : undefined;
      if (!keeper || keeperId === row.id) continue;
      shaped = { ...keeper, email: row.email ?? null };
    } else {
      shaped = row;
    }
    const key = `${shaped.id}|${String(shaped.email ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { merged_into_id: _drop, ...rest } = shaped;
    void _drop;
    out.push(rest);
  }
  return out;
}

/** Pure: true when a row read with the merge columns is a merged lead. A row without the column is live. */
export function isMergedLead(row: { merged_into_id?: string | null } | null | undefined): boolean {
  return !!row && typeof row.merged_into_id === "string" && row.merged_into_id.length > 0;
}

// ── reads that need a client ──────────────────────────────────────────────────

/** The smallest shape of a Supabase client these helpers use. The scoped client and the admin client both fit. */
type QueryResult = { data: unknown; error: unknown };
type Chain = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Chain;
  is: (column: string, value: null) => Chain;
  in: (column: string, values: readonly string[]) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => PromiseLike<QueryResult>;
};
export type LeadDb = { from: (table: string) => { select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Chain } };

const asDb = (db: unknown) => db as LeadDb;

/**
 * Follows a lead id to its keeper through the caller's client (RLS decides what is visible, so another firm's
 * id is `not-found`). `orgId` fences the read for a caller that already knows the org (the admin client).
 */
export async function resolveLeadId(db: unknown, id: string, orgId?: string | null): Promise<FollowResult> {
  const client = asDb(db);
  return followMerged(id, async (current) => {
    const result = await leadRead(({ merged }) => {
      const q = client.from("crm_lead").select(merged ? "id, merged_into_id" : "id").eq("id", current);
      return (orgId ? q.eq("org_id", orgId) : q).maybeSingle();
    });
    if (result.error) throw new Error("lead read failed");
    return (result.data as MergePointer | null) ?? null;
  });
}

export type MergedSet = { status: "ok"; ids: string[] } | { status: "unavailable"; ids: string[] };

/**
 * The keeper and every lead merged into it (the keeper first). The history that stays on a merged lead
 * (crm_activity, crm_file, client_proposal, crm_quote, ...) is read with `.in("lead_id", ids)`. Before 0107 it
 * is just the keeper. A failed read is `unavailable` WITH the keeper alone, so a page can still draw the
 * keeper's own history and say that the merged part couldn't be loaded.
 */
export async function mergedSetFor(db: unknown, keeperId: string): Promise<MergedSet> {
  const client = asDb(db);
  try {
    let merged = true;
    const result = await leadRead((kit) => {
      merged = kit.merged;
      if (!kit.merged) return Promise.resolve({ data: [], error: null } as QueryResult);
      return client.from("crm_lead").select("id").eq("merged_into_id", keeperId).limit(200);
    });
    if (result.error) return { status: "unavailable", ids: [keeperId] };
    if (!merged) return { status: "ok", ids: [keeperId] };
    const rows = Array.isArray(result.data) ? (result.data as { id?: unknown }[]) : [];
    const others = rows.map((r) => (typeof r.id === "string" ? r.id : null)).filter((v): v is string => !!v && v !== keeperId);
    return { status: "ok", ids: [keeperId, ...others] };
  } catch {
    return { status: "unavailable", ids: [keeperId] };
  }
}

/**
 * Whether this database can merge leads (lectual 0107's columns are there). Hidden on anything else: a missing
 * column (42703 / PGRST204) AND a failed probe both answer false, so Merge is never offered on a guess.
 */
export async function mergeAvailable(db: unknown): Promise<boolean> {
  if (leadMergeSupport() === "present") return true;
  if (leadMergeSupport() === "missing") return false;
  try {
    const { error } = await asDb(db).from("crm_lead").select("merged_into_id").limit(1);
    if (!error) {
      support = { kind: "present" };
      return true;
    }
    if (isMergeColumnMissing(error)) support = { kind: "missing", until: Date.now() + MISSING_TTL_MS };
    return false;
  } catch {
    return false;
  }
}
