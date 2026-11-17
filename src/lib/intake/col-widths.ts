import { clampSize } from "@/lib/review/sheet-edit";

/**
 * The Leads list's columns: which are drawn, how wide, and what a person's own widths look like. PURE. This is the Weekly review
 * Sheet's mechanism (sheet-edit.ts: `DEFAULT_COL_WIDTHS`, `colWidth`, `sheetMinWidth`, `clampSize`, `parseSizes`; a per-viewer width in
 * browser storage, never shared or required) over the Leads columns: pixel widths in a `<colgroup>`, ONE flexible column (Next step,
 * never narrower than `NEXT_MIN_WIDTH`), a stored width overriding the default.
 */
export type ColKey = "lead" | "stage" | "temp" | "source" | "owner" | "assistant" | "touch" | "next";
export const COL_ORDER: readonly ColKey[] = ["lead", "stage", "temp", "source", "owner", "assistant", "touch", "next"];

export const LEADS_COL_WIDTHS_KEY = "lx-leads-col-widths";
export const MIN_COL = 72;
export const MAX_COL = 640;
/** The "..." menu column is fixed. */
export const MENU_COL_WIDTH = 52;

/** Default widths in px (Next step is flexible: null). Chosen so the list, with the Assistant activity column and without an Owner column, fits 954px (1280 with the rail open). */
export const DEFAULT_COL_WIDTHS: Record<ColKey, number | null> = { lead: 154, stage: 150, temp: 116, source: 76, owner: 76, assistant: 140, touch: 110, next: null };
export const NEXT_MIN_WIDTH = 150;

export type ColSizes = Partial<Record<ColKey, number>>;
export const NO_COL_SIZES: ColSizes = {};

/** Owner and assistant columns are drawn only when something in view needs them. */
export function visibleColumns(opts: { owner: boolean; assistant: boolean }): ColKey[] {
  return COL_ORDER.filter((c) => (c === "owner" ? opts.owner : c === "assistant" ? opts.assistant : true));
}

/** The width a column is drawn at: this viewer's stored width, else the default; null = flexible (Next step). */
export function colWidth(sizes: ColSizes, col: ColKey): number | null {
  return sizes[col] ?? DEFAULT_COL_WIDTHS[col];
}

/** The narrowest the table gets before it scrolls sideways inside its card (flexible Next step counted at its minimum). */
export function tableMinWidth(cols: readonly ColKey[], sizes: ColSizes): number {
  let total = MENU_COL_WIDTH;
  for (const c of cols) total += colWidth(sizes, c) ?? NEXT_MIN_WIDTH;
  return total;
}

export function clampWidth(n: number): number {
  return clampSize(n, MIN_COL, MAX_COL);
}

/** A column resized by `delta` px from `from` (its current drawn width). */
export function resizedWidth(from: number, delta: number): number {
  return clampWidth(from + delta);
}

/** Reads what was stored; anything malformed is dropped, never trusted. */
export function parseColSizes(raw: string | null | undefined): ColSizes {
  if (!raw) return NO_COL_SIZES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return NO_COL_SIZES;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return NO_COL_SIZES;
  const out: ColSizes = {};
  for (const c of COL_ORDER) {
    const v = (data as Record<string, unknown>)[c];
    if (typeof v === "number" && Number.isFinite(v)) out[c] = clampWidth(v);
  }
  return out;
}

/** One column back to its default (Home, or a double click on the edge). */
export function withoutCol(sizes: ColSizes, col: ColKey): ColSizes {
  const next = { ...sizes };
  delete next[col];
  return next;
}
