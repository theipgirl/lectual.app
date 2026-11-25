import type { Layout, LayoutColumn, LayoutDefault } from "./types";

/**
 * Applying a firm's saved layout to the columns a viewer may have. Pure.
 *
 * `defaults` is what this viewer may have, in default order: the caller built it with the viewer's rules already applied (a Money firm
 * column is only in the list for a real owner: `columnsFor` with `canSeeCustomMoney`). A saved key that is not in `defaults` is therefore
 * DROPPED: a layout can reorder, rename and hide what a viewer may have, and can never add a column they may not (a `cf:` key of a field
 * that is archived, of the other section or Money for a non-owner draws nothing).
 */

/** A default column as laid out: its saved label, width and whether it is hidden. `column` is the caller's own object, untouched. */
export type ResolvedColumn<C extends LayoutDefault> = { column: C; key: string; label: string; builtinLabel: string; renamed: boolean; hidden: boolean; width: number | null };

/**
 * Every column the viewer may have, in the order to draw them, hidden ones included (a chooser or a menu needs them). Rules:
 *  - saved order first; a saved key that no longer exists is dropped; a repeated key counts once;
 *  - a column missing from the saved layout comes after the saved ones, in default order, visible;
 *  - a pinned column is first and never hidden, whatever the layout says.
 * With no saved layout it is the defaults as they are.
 */
export function resolveLayout<C extends LayoutDefault>(defaults: readonly C[], saved: Layout | null | undefined): ResolvedColumn<C>[] {
  const byKey = new Map(defaults.map((d) => [d.key, d]));
  const savedBy = new Map<string, LayoutColumn>();
  const order: string[] = [];
  for (const s of saved ?? []) {
    if (!byKey.has(s.key) || savedBy.has(s.key)) continue;
    savedBy.set(s.key, s);
    order.push(s.key);
  }
  for (const d of defaults) if (!savedBy.has(d.key)) order.push(d.key);
  const resolved = order.map((key): ResolvedColumn<C> => {
    const column = byKey.get(key)!;
    const s = savedBy.get(key);
    const label = s?.label ?? column.label;
    return { column, key, label, builtinLabel: column.label, renamed: label !== column.label, hidden: column.pinned ? false : (s?.hidden ?? false), width: s?.width ?? null };
  });
  return [...resolved.filter((r) => r.column.pinned), ...resolved.filter((r) => !r.column.pinned)];
}

/**
 * The columns to DRAW: `resolveLayout` without the hidden ones, each with its saved label and width. The caller's own column
 * fields (editable, kind, title, ...) come through unchanged. If the layout would leave nothing to draw, the defaults are drawn: a
 * table is never empty because of a layout.
 */
export function applyLayout<C extends LayoutDefault>(defaults: readonly C[], saved: Layout | null | undefined): (C & { width: number | null })[] {
  const shown = resolveLayout(defaults, saved).filter((r) => !r.hidden);
  const list = shown.length > 0 ? shown : resolveLayout(defaults, null);
  return list.map((r) => ({ ...r.column, label: r.label, width: r.width }));
}

/** The resolved columns as a layout, the shape that is saved: every column the viewer has, in order, with its label (null = built-in name), hidden flag and width. */
export function layoutOf<C extends LayoutDefault>(resolved: readonly ResolvedColumn<C>[]): Layout {
  return resolved.map((r) => ({ key: r.key, label: r.renamed ? r.label : null, hidden: r.hidden, width: r.width }));
}
