import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * Thin, typed access to the three SECURITY DEFINER functions added in
 * supabase/migrations/0031_member_identity.sql.
 *
 * They are not in `Database["public"]["Functions"]` yet — src/lib/db/types.ts
 * is generated from the applied schema and 0031 is not applied — so the call
 * goes through one narrow cast that lives here and nowhere else. Regenerating
 * types.ts after the migration lands lets every call site drop back to the
 * plain `supabase.rpc(...)` overloads; nothing else has to change.
 */

export const MEMBER_RPCS = [
  "org_member_directory",
  "org_admin_lookup_user_id",
  "revoke_member_sessions",
] as const;

export type MemberRpc = (typeof MEMBER_RPCS)[number];

export type RpcError = { message: string; code?: string; details?: string | null };
export type RpcResult<T> = { data: T | null; error: RpcError | null };

export async function callMemberRpc<T>(
  supabase: SupabaseClient<Database>,
  fn: MemberRpc,
  args?: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const untyped = supabase as unknown as {
    rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<RpcResult<T>>;
  };
  return untyped.rpc(fn, args);
}

/**
 * True when the failure is "this function doesn't exist yet" — i.e. 0031 has
 * not been applied to this database. PostgREST reports an unknown RPC as
 * PGRST202; Postgres itself uses 42883 (undefined_function).
 *
 * Distinguishing it matters: a missing migration is an operator problem with a
 * clear fix, and must never be reported to a firm admin as "you don't have
 * permission" or silently swallowed as "no members".
 */
export function isMissingFunctionError(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

/** Operator-facing hint appended to errors caused by the unapplied migration. */
export const MEMBER_RPC_MIGRATION_HINT =
  "Apply supabase/migrations/0031_member_identity.sql to the database to enable this.";
