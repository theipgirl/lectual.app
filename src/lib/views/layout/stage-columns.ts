import type { Layout, ViewKey } from "./types";

/**
 * The columns of a STAGE board (the Matters and Contracts boards, and the Leads stage board): one per stage, and for those boards a saved
 * layout decides ONE thing, which columns are hidden. Pure, and free of any server or page import so a client board can use it.
 */

/** The views whose columns are stages: a layout write for one of these may only hide or show a column. */
export const STAGE_BOARD_VIEWS: readonly ViewKey[] = ["matters_board", "contracts_board", "leads_board"];
export const isStageBoardView = (view: unknown): view is "matters_board" | "contracts_board" | "leads_board" => typeof view === "string" && (STAGE_BOARD_VIEWS as readonly string[]).includes(view);

/** A stage column's key in a layout: `st_` and the stage id without its dashes (35 characters, inside the 40 a layout key may have). */
export function stageColumnKey(stageId: string): string {
  return `st_${stageId.replace(/-/g, "").toLowerCase()}`;
}

/**
 * A Board layout decides ONE thing here: which columns are hidden. The ORDER and the NAMES of stage columns are the stages' own (the
 * owner's stage menu moves and renames the stage itself, for everyone and for every rule), so the saved layout's order and labels are
 * deliberately not applied: two orderings of one pipeline would disagree the day a stage is moved. A column the layout doesn't name is
 * shown. If the layout would hide every column, none is hidden (a Board is never empty because of a layout).
 */
export function splitHiddenColumns<T extends { key: string }>(columns: readonly T[], saved: Layout | null | undefined): { shown: T[]; hidden: T[] } {
  const hiddenKeys = new Set((saved ?? []).filter((c) => c.hidden).map((c) => c.key));
  const hidden = columns.filter((c) => hiddenKeys.has(c.key));
  if (hidden.length === columns.length) return { shown: [...columns], hidden: [] };
  return { shown: columns.filter((c) => !hiddenKeys.has(c.key)), hidden };
}
