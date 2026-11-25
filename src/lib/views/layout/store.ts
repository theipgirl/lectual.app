import "server-only";
import type { Layout, ViewKey } from "./types";
import type { WriteAnswer } from "./save";

/**
 * The write side of a firm's saved layouts (lectual 0119 `crm_view_layout`, proposed): the scoped client's own insert and update, one row
 * per call, never an upsert (its conflict update would name columns that have no UPDATE grant). RLS lets only an owner membership row write.
 * The client is a parameter and nothing here creates one. Each function answers with the database's error object as it came; `save.ts`
 * turns it into words by its code only.
 *
 * The insert names exactly `org_id, view_key, columns` (the grant); `rev`, `updated_by` and the stamps are the trigger's. The update
 * names `columns` alone and is fenced on the `rev` the caller read, so a second owner's stale change updates 0 rows.
 */

type Answer = { data: unknown; error: unknown };
type Chain = PromiseLike<Answer> & { eq(column: string, value: unknown): Chain; select(columns: string): Chain };
type Table = { insert(row: Record<string, unknown>): PromiseLike<Answer>; update(patch: Record<string, unknown>): Chain };
export type LayoutWriteClient = { from(table: string): Table };

export function layoutStore(db: LayoutWriteClient) {
  return {
    async insert(view: ViewKey, orgId: string, columns: Layout): Promise<WriteAnswer> {
      const { error } = await db.from("crm_view_layout").insert({ org_id: orgId, view_key: view, columns });
      return { error: error ?? null };
    },
    async update(view: ViewKey, columns: Layout, rev: number): Promise<WriteAnswer> {
      const { data, error } = await db.from("crm_view_layout").update({ columns }).eq("view_key", view).eq("rev", rev).select("rev");
      if (error) return { error };
      const row = Array.isArray(data) ? (data[0] as { rev?: unknown } | undefined) : undefined;
      return { error: null, rev: row && typeof row.rev === "number" && Number.isInteger(row.rev) ? row.rev : null };
    },
  };
}
