import { COLUMN_PREFS_VERSION, parseStoredDocument, type SectionPrefs, type SheetSectionId } from "./sheet-columns";

/**
 * Where a person's column choices live: browser storage, one key, `{ v: 1, trademarks: { order, hidden }, contracts: { order, hidden } }`.
 * A per-viewer convenience like the column widths: no server action, nothing shared, and the server render never depends on it.
 * Every read and write is in try/catch: storage that throws (private mode) leaves the default order and shows nothing.
 */
export const COLUMN_PREFS_KEY = "lx-review-sheet-columns";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type PrefsDocument = Partial<Record<SheetSectionId, unknown>>;

export function readPrefsDocument(storage: StorageLike | null | undefined): PrefsDocument | null {
  try {
    return parseStoredDocument(storage?.getItem(COLUMN_PREFS_KEY));
  } catch {
    return null;
  }
}

export function serializePrefs(doc: Partial<Record<SheetSectionId, SectionPrefs | unknown>>): string {
  return JSON.stringify({ v: COLUMN_PREFS_VERSION, trademarks: doc.trademarks ?? null, contracts: doc.contracts ?? null });
}

/** Returns whether it was stored; a throwing store is simply not stored. */
export function writePrefsDocument(storage: StorageLike | null | undefined, doc: PrefsDocument): boolean {
  try {
    storage?.setItem(COLUMN_PREFS_KEY, serializePrefs(doc));
    return !!storage;
  } catch {
    return false;
  }
}
