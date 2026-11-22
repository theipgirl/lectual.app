/**
 * The narrow, untyped database shape the e-sign code needs (Sprint 5a), so every core can be driven by a fake in tests. PURE.
 * Production passes the real Supabase client: the scoped one for a signed-in person, the service role only in the files the
 * hygiene test allows (`adobe-connection.ts`, `start.ts`, `path.ts`, `disconnect.ts`, and the 5b files).
 */

export type EsignDbError = { code?: string; message?: string } | null;
export type EsignDbResult<T = unknown> = { data: T; error: EsignDbError };

export interface EsignQuery<T = unknown> extends PromiseLike<EsignDbResult<T>> {
  select(columns: string): EsignQuery<T>;
  update(patch: Record<string, unknown>): EsignQuery<T>;
  insert(rows: unknown): EsignQuery<T>;
  delete(): EsignQuery<T>;
  eq(column: string, value: unknown): EsignQuery<T>;
  in(column: string, values: readonly unknown[]): EsignQuery<T>;
  lt(column: string, value: unknown): EsignQuery<T>;
  order(column: string, options?: { ascending?: boolean }): EsignQuery<T>;
  limit(count: number): EsignQuery<T>;
  maybeSingle(): PromiseLike<EsignDbResult<T>>;
}

export interface EsignDb {
  from(table: string): EsignQuery;
  rpc?(fn: string, args: Record<string, unknown>): PromiseLike<EsignDbResult>;
}

/** lectual 0113 isn't applied: a missing table / function / column. Matched BY CODE, never by message text. */
const NOT_SET_UP = new Set(["42P01", "PGRST205", "42883", "PGRST202", "42703", "PGRST204"]);

export function isNotSetUpError(error: EsignDbError): boolean {
  return Boolean(error && typeof error.code === "string" && NOT_SET_UP.has(error.code));
}

/** A request that is still open: one per proposal version (0113's partial unique index). */
export const OPEN_REQUEST_STATUSES = ["creating", "out_for_signature"] as const;
export type RequestStatus = "creating" | "out_for_signature" | "completed" | "cancelled" | "expired" | "declined" | "failed";

/** A `creating` row older than this is closed as `failed` (`creation_interrupted`). */
export const STUCK_CREATING_MS = 10 * 60 * 1000;

export function stuckCutoff(now: Date): string {
  return new Date(now.getTime() - STUCK_CREATING_MS).toISOString();
}
