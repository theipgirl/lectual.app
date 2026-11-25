import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { parseLayout } from "./validate";
import type { LayoutRead } from "./state";
import type { ViewKey } from "./types";

/**
 * The read side of a firm's saved layouts (lectual 0119 `crm_view_layout`, proposed: not applied anywhere). Takes a scoped client (the
 * caller's; RLS on the active firm bounds the row) and never touches the service role. Three states, judged on the error CODE, never on
 * message text:
 *   ok           the firm's layout (`layout: null` = no row, the standard layout) and the `rev` it was read at;
 *   not-set-up   the table (or a column of it) isn't there yet (42P01 / PGRST205 / 42703): not a failure, nothing is said;
 *   unavailable  any other error, a non-row answer, or a stored layout this app can't read (a shape the database could not have stored).
 * `not-set-up` and `unavailable` both draw the STANDARD layout: a failed read is never an empty table. `unavailable` also says so, once.
 */

const MISSING = new Set(["42P01", "PGRST205", "42703"]);

type Answer = { data: unknown; error: unknown };
type ReadClient = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<Answer> } } } };

const codeOf = (e: unknown): string | null => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : null);

export async function readViewLayout(db: unknown, viewKey: ViewKey): Promise<LayoutRead> {
  try {
    const { data, error } = await (db as ReadClient).from("crm_view_layout").select("columns, rev").eq("view_key", viewKey).maybeSingle();
    if (error) {
      const code = codeOf(error);
      return code !== null && MISSING.has(code) ? { status: "not-set-up" } : { status: "unavailable" };
    }
    if (data === null || data === undefined) return { status: "ok", layout: null, rev: null };
    if (typeof data !== "object" || Array.isArray(data)) return { status: "unavailable" };
    const row = data as { columns?: unknown; rev?: unknown };
    const layout = parseLayout(row.columns);
    if (!layout || typeof row.rev !== "number" || !Number.isInteger(row.rev) || row.rev < 1) return { status: "unavailable" };
    return { status: "ok", layout, rev: row.rev };
  } catch {
    return { status: "unavailable" };
  }
}

/** One view's saved layout, through the caller's scoped client. */
export async function loadViewLayout(viewKey: ViewKey): Promise<LayoutRead> {
  try {
    return await readViewLayout(await getScopedClient(), viewKey);
  } catch {
    return { status: "unavailable" };
  }
}
