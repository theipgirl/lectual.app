"use client";

import { useSyncExternalStore } from "react";
import { COLUMN_PREFS_KEY, readPrefsDocument, writePrefsDocument, type PrefsDocument } from "@/lib/review/column-prefs-storage";
import { applyColumnPrefs, parseColumnPrefs, prefsReducer, type PrefsAction, type SectionPrefs, type SheetColumn, type SheetSectionId } from "@/lib/review/sheet-columns";

/**
 * A person's column choices for the List, shared by the chooser and both tables (one store, so a change shows at once). Draw-only:
 * the server's `columnsFor` list goes in, a thinner or reordered list of the SAME columns comes out. The first render (server and
 * hydration) is always the default order; the stored choice applies after mount. Storage that throws leaves the default order, with
 * the person's changes kept for this visit only and nothing shown.
 */

let memory: PrefsDocument | null = null;
let cache: { raw: string | null; doc: PrefsDocument | null } | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function rawStored(): string | null {
  try {
    return storage()?.getItem(COLUMN_PREFS_KEY) ?? null;
  } catch {
    return null;
  }
}

function snapshot(): PrefsDocument | null {
  if (memory) return memory;
  const raw = rawStored();
  if (!cache || cache.raw !== raw) cache = { raw, doc: readPrefsDocument(storage()) };
  return cache.doc;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COLUMN_PREFS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: PrefsDocument) {
  const stored = writePrefsDocument(storage(), next);
  memory = stored ? null : next;
  cache = null;
  for (const l of listeners) l();
}

export type ColumnPrefsApi = {
  /** The columns to draw, in the person's order. */
  columns: SheetColumn[];
  /** Every allowed column in the person's order, with the hidden ones listed (the chooser's rows). */
  prefs: SectionPrefs;
  change(action: PrefsAction): void;
};

/** `initial` is a drawing-only starting document (a test or preview passes explicit choices; storage is never read then). */
export function useColumnPrefs(section: SheetSectionId, allowed: readonly SheetColumn[], initial?: PrefsDocument): ColumnPrefsApi {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const doc = initial ?? stored;
  const ids = allowed.map((c) => c.id);
  const prefs = parseColumnPrefs(doc?.[section], ids);
  return {
    columns: applyColumnPrefs(allowed, doc?.[section] ?? null),
    prefs,
    change(action) {
      if (initial) return;
      write({ ...(snapshot() ?? {}), [section]: prefsReducer(prefs, action, ids) });
    },
  };
}
