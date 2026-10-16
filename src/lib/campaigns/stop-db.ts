/**
 * The narrow PostgREST surface the stop code uses — shared by the scoped
 * client (staff actions, through RLS) and the service-role client (the public
 * quote page and the mailbox sync, fenced by the org_id of the row that
 * recorded the fact).
 *
 * Declared structurally, like `PublicQuotesDb` in src/lib/quotes/public.ts, so
 * the same functions run against either client and against the fakes in
 * tests/. Callers cast once at the call site; nothing here constructs a
 * client, and so nothing here can widen what a caller may reach.
 */

export type StopDbError = { code?: string; message?: string } | null;
export type StopDbResult = { data: unknown; error: StopDbError };

export interface StopDbQuery extends PromiseLike<StopDbResult> {
  select(columns: string): StopDbQuery;
  update(patch: Record<string, unknown>): StopDbQuery;
  insert(rows: unknown): StopDbQuery;
  eq(column: string, value: unknown): StopDbQuery;
  in(column: string, values: readonly unknown[]): StopDbQuery;
  lt(column: string, value: unknown): StopDbQuery;
  maybeSingle(): PromiseLike<StopDbResult>;
}

export interface StopDb {
  from(table: string): StopDbQuery;
}

export function rowsOf(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
