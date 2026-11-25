/**
 * The retired per-person column chooser kept `{ v, trademarks: { order, hidden }, contracts: { order, hidden } }` in browser storage under
 * this key. Nothing reads it any more: the firm's layout decides the columns. The only thing left to do with it is delete it, once,
 * so no stale value lingers. Column WIDTHS live under their own key (`SHEET_SIZES_KEY`) and are not touched here.
 */
export const LEGACY_COLUMN_PREFS_KEY = "lx-review-sheet-columns";

type RemovableStorage = Pick<Storage, "removeItem">;

/** Removes the old key. Returns whether the call went through; a store that throws or is missing is simply left alone. Never throws. */
export function removeLegacyColumnPrefs(storage: RemovableStorage | null | undefined): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(LEGACY_COLUMN_PREFS_KEY);
    return true;
  } catch {
    return false;
  }
}
