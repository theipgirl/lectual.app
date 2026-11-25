/**
 * A firm's saved layout for one List or Board (lectual 0119 `crm_view_layout`, proposed). Pure: no React, no server import, no database.
 *
 * A layout is the firm's view for everyone (firm-wide, never per person). It names columns by a FIXED key and carries only what the firm
 * may change: the order, a display label, whether the column is hidden and its width. A rename is a LABEL only; data, filters and every
 * rule keep reading the key.
 */
export const VIEW_KEYS = ["review_list", "review_board", "matters_list", "matters_board", "contracts_list", "contracts_board", "leads_list", "leads_board"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export type LayoutColumn = {
  /** A built-in column's fixed key (`^[a-z][a-z0-9_]{0,39}$`) or a firm column, `cf:<lowercase uuid>`. */
  key: string;
  /** The firm's own name for the column, or null = the column's built-in name. */
  label: string | null;
  hidden: boolean;
  /** Pixels (40..800), or null = the default width. */
  width: number | null;
};
export type Layout = LayoutColumn[];

/** The same limits as 0119's `crm_view_layout_columns_valid`. */
export const LAYOUT_MIN_COLUMNS = 1;
export const LAYOUT_MAX_COLUMNS = 80;
export const LABEL_MAX = 60;
export const WIDTH_MIN = 40;
export const WIDTH_MAX = 800;

/** What a column needs to be laid out: its fixed key, its built-in name, and whether it is the pinned one (first, never hidden). */
export type LayoutDefault = { key: string; label: string; pinned?: boolean };
