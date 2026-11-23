/**
 * The untyped service-role client shape the emailed-signing path uses (the same shape as `src/lib/proposals/public.ts`'s
 * `PublicProposalsDb`, plus `.in`-free reads), so tests drive it with a fake and nothing here can be handed a scoped client by
 * mistake at the type level. Production passes the public module's service-role client.
 */

export type SigningDbError = { code?: string; message?: string } | null;
export type SigningDbResult<T = unknown> = { data: T; error: SigningDbError };

export interface SigningDbQuery<T = unknown> extends PromiseLike<SigningDbResult<T>> {
  select(columns: string): SigningDbQuery<T>;
  update(patch: Record<string, unknown>): SigningDbQuery<T>;
  eq(column: string, value: unknown): SigningDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): SigningDbQuery<T>;
  limit(count: number): SigningDbQuery<T>;
  maybeSingle(): PromiseLike<SigningDbResult<T>>;
}

export interface SigningDb {
  from(table: string): SigningDbQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<SigningDbResult>;
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
