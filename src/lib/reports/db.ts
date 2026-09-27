import "server-only";

/**
 * Reading a table that might not exist in this environment yet — the same
 * problem `src/lib/quotes/load.ts` solves for `crm_quote` (0068 applied by
 * hand to two cloud projects, so "code deployed, migration not applied here"
 * is a reachable state; AGENTS.md documents dev once falling four migrations
 * behind prod). `agent_run` and `crm_intake_submission` are in exactly that
 * position on lectual-prod today.
 *
 * Three states, same discipline as `src/lib/queue/load.ts`:
 *   ok           — reached the table; `rows` is the truth.
 *   missing      — this environment doesn't have the table yet. Not an
 *                  outage and not "zero rows" — there is nothing to count.
 *   unavailable  — a real read failure. We don't know what's in there.
 */
export type TableReadStatus = "ok" | "missing" | "unavailable";

export type TableRead<T> = {
  status: TableReadStatus;
  rows: T[];
  error?: unknown;
};

type PostgrestLikeError = { code?: string; message?: string } | null | undefined;

/** Distinguishes "table not in this schema cache" from a real outage, on the
 * error CODE — never on message text (mirrors quotes/load.ts's isMissingTableError). */
export function isMissingTableError(error: PostgrestLikeError): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /schema cache|relation .* does not exist|does not exist/i.test(error.message ?? "");
}

/**
 * Runs a scoped-client query and shapes its outcome into the three states
 * above. Never throws — a broken or missing report source must not take
 * down the report page it appears on, same rule as loadActiveQueue.
 */
export async function readRows<T>(
  run: () => PromiseLike<{ data: T[] | null; error: PostgrestLikeError }>,
): Promise<TableRead<T>> {
  try {
    const { data, error } = await run();
    if (error) {
      if (isMissingTableError(error)) return { status: "missing", rows: [] };
      console.error("[reports] read failed:", error);
      return { status: "unavailable", rows: [], error };
    }
    return { status: "ok", rows: data ?? [] };
  } catch (error) {
    if (isMissingTableError(error as PostgrestLikeError)) return { status: "missing", rows: [] };
    console.error("[reports] read failed:", error);
    return { status: "unavailable", rows: [], error };
  }
}
