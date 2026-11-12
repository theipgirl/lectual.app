/**
 * Bulk "Move to..." selection rules. PURE. A lead can only be moved if it is ON SCREEN: the ids sent are the ticked ones
 * that are also rendered (a lead ticked and then hidden by a filter, a set chip, a page or a column cap is never moved),
 * "Select the N shown" means the rendered cards, and any change of what is shown clears the selection.
 */
import { BULK_MOVE_MAX } from "@/lib/pipeline/bulk-move";

/** The ticked ids that are rendered, in rendered order. These are the only ids a bulk move may send. */
export function movableIds(selected: ReadonlySet<string>, renderedIds: readonly string[]): string[] {
  return renderedIds.filter((id) => selected.has(id));
}

/** How many ticked leads are not on screen (so the bar can say "M hidden"). */
export function hiddenSelectedCount(selected: ReadonlySet<string>, renderedIds: readonly string[]): number {
  const shown = new Set(renderedIds);
  let n = 0;
  for (const id of selected) if (!shown.has(id)) n++;
  return n;
}

/** "Select the N shown": the rendered ids, at most one request's worth. */
export function selectShown(renderedIds: readonly string[]): string[] {
  return renderedIds.slice(0, BULK_MOVE_MAX);
}

/** The key whose change clears the selection: the set, the filters, the paging, the view and the grouping. */
export function selectionKey(parts: { set: string; query: string; show: number; view: string; group: string }): string {
  return JSON.stringify([parts.set, parts.query, parts.show, parts.view, parts.group]);
}
