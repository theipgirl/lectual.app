import { applyLayout } from "@/lib/views/layout/apply";
import { cfKey } from "@/lib/views/layout/validate";
import type { Layout, LayoutDefault } from "@/lib/views/layout/types";
import { isCustomColumnId, type BuiltinColumnId, type ColumnId, type SheetColumn } from "./sheet-columns";

/**
 * The Weekly review List's columns as a firm's saved layout names them. Pure.
 *
 * A layout names a column by a FIXED key that the database accepts (`^[a-z][a-z0-9_]{0,39}$`, or `cf:<lowercase uuid>`). The registry's own
 * ids are camel case for some columns (`legalFee`), so this is the one place the two are tied together; neither changes when a firm
 * renames a column.
 */
export const REVIEW_LAYOUT_KEYS: Record<BuiltinColumnId, string> = {
  client: "client",
  mark: "mark",
  serial: "serial",
  status: "status",
  source: "source",
  notes: "notes",
  owner: "owner",
  start: "start",
  legalFee: "legal_fee",
  legalFeeDue: "legal_fee_due",
  govFee: "gov_fee",
  govFeeDue: "gov_fee_due",
  oaDue: "oa_due",
  practiceArea: "practice_area",
  next: "next",
  waiting: "waiting",
  contact: "contact",
};

/** The layout key of a registry column. */
export function layoutKeyOf(id: ColumnId): string {
  return isCustomColumnId(id) ? cfKey(id.slice(3)) : REVIEW_LAYOUT_KEYS[id];
}

/**
 * The columns a viewer may have (`columnsFor`), in the firm's saved order, with its labels and widths, its hidden ones left out. A layout
 * key with no column here (a Money firm column for a non-owner, an archived field, the other section's column) is ignored, so a layout
 * can reorder, rename and hide what a viewer has and never adds what they may not have. No saved layout: the same columns, untouched.
 * The returned columns are the registry's own, with only `header` and `width` changed; every id (what the editors, the chooser and the
 * cells key on) stays.
 */
export function applyReviewLayout(columns: readonly SheetColumn[], saved: Layout | null | undefined): SheetColumn[] {
  if (!saved) return [...columns];
  const defaults = columns.map((c): LayoutDefault & { col: SheetColumn } => ({ key: layoutKeyOf(c.id), label: c.header, pinned: c.pinned, col: c }));
  return applyLayout(defaults, saved).map(({ col, label, width }) => ({ ...col, header: label, ...(width !== null ? { width } : {}) }));
}
