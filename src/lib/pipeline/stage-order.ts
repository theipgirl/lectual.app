/**
 * The one order a firm's stages are drawn and chosen in. Pure.
 *
 * `crm_stage.order_index` is a NOT NULL integer in the schema (checked in `src/lib/db/types.ts`; this repo
 * has no database access to read RPB's actual rows), but nothing makes it UNIQUE: two stages can share a
 * number, and a board sorted on that number alone then draws them in whatever order the database
 * returned, which can differ between requests. A missing or non-finite number (a hand-built row, a
 * future nullable column) sorts last rather than first. Ties break on the stage's name, then its id, so
 * the same pipeline always draws the same way, and "the firm's first stage" means the same thing in the
 * board, the Pipeline page, the importer and the new-lead path.
 */

export type OrderedStage = { id: string; name: string; order_index: number | null };

function orderOf(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function compareStageOrder(a: OrderedStage, b: OrderedStage): number {
  const x = orderOf(a.order_index);
  const y = orderOf(b.order_index);
  if (x !== y) return x < y ? -1 : 1;
  const byName = String(a.name ?? "").localeCompare(String(b.name ?? ""), "en");
  return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A copy of the stages in the firm's pipeline order. */
export function inPipelineOrder<T extends OrderedStage>(stages: readonly T[]): T[] {
  return [...stages].sort(compareStageOrder);
}
