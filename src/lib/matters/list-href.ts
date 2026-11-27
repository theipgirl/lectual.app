/**
 * Matters opens on the BOARD when the address has no `view`. The LIST therefore always carries its explicit value.
 * This is the ONE place that value is written for a link that means "the list" (see BOARD-DEFAULT.md in the audit folder).
 * Pure, no imports.
 */
export const MATTERS_LIST_VALUE = "table";
export const MATTERS_LIST_PATH = `/dashboard/matters/?view=${MATTERS_LIST_VALUE}`;

/** The Matters LIST's address, with any further query parts (`"group=all&seg=stalled"`) after the view. */
export function mattersListHref(extra?: string): string {
  const more = (extra ?? "").replace(/^[?&]+/, "");
  return more ? `${MATTERS_LIST_PATH}&${more}` : MATTERS_LIST_PATH;
}

/** `?view=` on Matters: no value opens the Board; `board` is the Board; the list value (and any other value, as before) is the list. */
export function mattersViewFromParam(view: string | string[] | undefined): "board" | "table" {
  const raw = (Array.isArray(view) ? view[0] : view ?? "").trim();
  return raw === "" || raw === "board" ? "board" : "table";
}
