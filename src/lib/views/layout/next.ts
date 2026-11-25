import { LAYOUT_MAX_COLUMNS, WIDTH_MAX, WIDTH_MIN, type Layout, type LayoutColumn } from "./types";
import { cleanLabel, isLayoutKey } from "./validate";

/**
 * The next layout after a change, as pure helpers (build step 3's actions call them; nothing here reads or writes). Each takes the CURRENT
 * layout (`layoutOf(resolveLayout(...))`, every column the viewer has, in order, hidden ones included) and returns either the new layout or a
 * `reason` for a fixed sentence. A returned layout always passes `parseLayout`; the input is never changed.
 *
 * `pinned` is the keys that can't be hidden or moved (the link to the record): they hold the first places.
 */
export type Next = { ok: true; layout: Layout } | { ok: false; reason: NextRefusal };
export type NextRefusal = "unknown-column" | "pinned" | "last-column" | "too-many" | "bad-key" | "key-taken" | "empty-label" | "label-too-long" | "label-characters" | "nothing-to-move" | "bad-width";

const refuse = (reason: NextRefusal): Next => ({ ok: false, reason });
const indexOf = (layout: Layout, key: string): number => layout.findIndex((c) => c.key === key);
const swapIn = (layout: Layout, key: string, change: Partial<LayoutColumn>): Layout => layout.map((c) => (c.key === key ? { ...c, ...change } : c));
const visibleCount = (layout: Layout): number => layout.filter((c) => !c.hidden).length;

/**
 * Rename: the LABEL only. A blank label, or one equal to the built-in name (`builtinLabel`), clears the override (the column reads its own
 * name again). A label with a control or invisible character, or over 60 characters, is refused.
 */
export function renameColumn(layout: Layout, key: string, raw: string, builtinLabel?: string): Next {
  const i = indexOf(layout, key);
  if (i < 0) return refuse("unknown-column");
  if (raw.trim() === "") return { ok: true, layout: swapIn(layout, key, { label: null }) };
  const c = cleanLabel(raw);
  if (!c.ok) return refuse(c.reason === "too-long" ? "label-too-long" : c.reason === "characters" ? "label-characters" : "empty-label");
  return { ok: true, layout: swapIn(layout, key, { label: c.label === builtinLabel ? null : c.label }) };
}

/** Hide or show. A pinned column is never hidden, and the last visible column can't be hidden (a table is never empty). */
export function setHidden(layout: Layout, key: string, hidden: boolean, pinned: readonly string[] = []): Next {
  const i = indexOf(layout, key);
  if (i < 0) return refuse("unknown-column");
  if (hidden && pinned.includes(key)) return refuse("pinned");
  if (hidden && !layout[i].hidden && visibleCount(layout) <= 1) return refuse("last-column");
  return { ok: true, layout: swapIn(layout, key, { hidden }) };
}

/**
 * Move one place left (-1) or right (1), past the next VISIBLE column in that direction (a hidden neighbour is stepped over, so the change
 * is seen). Nothing moves into the pinned places, and a pinned column doesn't move.
 */
export function moveColumn(layout: Layout, key: string, dir: -1 | 1, pinned: readonly string[] = []): Next {
  const from = indexOf(layout, key);
  if (from < 0) return refuse("unknown-column");
  if (pinned.includes(key)) return refuse("pinned");
  let to = from + dir;
  while (to >= 0 && to < layout.length && layout[to].hidden && !pinned.includes(layout[to].key)) to += dir;
  if (to < 0 || to >= layout.length || pinned.includes(layout[to].key)) return refuse("nothing-to-move");
  const out = [...layout];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return { ok: true, layout: out };
}

/**
 * Move a column to a place in the layout (a 0-based index among ALL columns, hidden ones included). A pinned column doesn't move, and
 * nothing moves into the pinned places (the index is raised to the first free one).
 */
export function moveColumnTo(layout: Layout, key: string, index: number, pinned: readonly string[] = []): Next {
  const from = indexOf(layout, key);
  if (from < 0) return refuse("unknown-column");
  if (pinned.includes(key)) return refuse("pinned");
  if (!Number.isInteger(index)) return refuse("nothing-to-move");
  const firstFree = layout.filter((c) => pinned.includes(c.key)).length;
  const to = Math.min(layout.length - 1, Math.max(firstFree, index));
  if (to === from) return refuse("nothing-to-move");
  const out = [...layout];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return { ok: true, layout: out };
}

/**
 * Move a column beside another one: the owner's Move left / Move right. The browser names the VISIBLE neighbour it saw, so the move is
 * seen even when the layout also holds columns that are not drawn (the other section's, a person with no rows). Both keys must be in the
 * layout; a pinned column doesn't move and nothing goes to the left of one. Placing it where it already is, is no move.
 */
export function moveColumnBeside(layout: Layout, key: string, relativeTo: string, side: "left" | "right", pinned: readonly string[] = []): Next {
  if (key === relativeTo) return refuse("nothing-to-move");
  const from = indexOf(layout, key);
  if (from < 0 || indexOf(layout, relativeTo) < 0) return refuse("unknown-column");
  if (pinned.includes(key)) return refuse("pinned");
  if (side === "left" && pinned.includes(relativeTo)) return refuse("pinned");
  const without = layout.filter((c) => c.key !== key);
  const at = without.findIndex((c) => c.key === relativeTo);
  const out = [...without];
  out.splice(side === "left" ? at : at + 1, 0, layout[from]);
  if (out.every((c, i) => c.key === layout[i].key)) return refuse("nothing-to-move");
  return { ok: true, layout: out };
}

/** Add a column to the left or right of another (a new firm column: the key is its `cf:` key). Left of a pinned column is refused. */
export function insertColumn(layout: Layout, column: { key: string; label?: string | null; width?: number | null }, relativeTo: string, side: "left" | "right", pinned: readonly string[] = []): Next {
  if (layout.length >= LAYOUT_MAX_COLUMNS) return refuse("too-many");
  if (!isLayoutKey(column.key)) return refuse("bad-key");
  if (indexOf(layout, column.key) >= 0) return refuse("key-taken");
  const at = indexOf(layout, relativeTo);
  if (at < 0) return refuse("unknown-column");
  if (side === "left" && pinned.includes(relativeTo)) return refuse("pinned");
  let label: string | null = null;
  if (column.label !== undefined && column.label !== null) {
    const c = cleanLabel(column.label);
    if (!c.ok) return refuse(c.reason === "too-long" ? "label-too-long" : c.reason === "characters" ? "label-characters" : "empty-label");
    label = c.label;
  }
  const width = column.width === undefined || column.width === null ? null : Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(column.width)));
  const out = [...layout];
  out.splice(side === "left" ? at : at + 1, 0, { key: column.key, label, hidden: false, width });
  return { ok: true, layout: out };
}

/** A width in pixels, clamped to 40..800 (null clears it). */
export function setWidth(layout: Layout, key: string, px: number | null): Next {
  if (indexOf(layout, key) < 0) return refuse("unknown-column");
  if (px === null) return { ok: true, layout: swapIn(layout, key, { width: null }) };
  if (!Number.isFinite(px)) return refuse("bad-width");
  return { ok: true, layout: swapIn(layout, key, { width: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(px))) }) };
}
