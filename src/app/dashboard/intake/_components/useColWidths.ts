"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { LEADS_COL_WIDTHS_KEY, NO_COL_SIZES, parseColSizes, resizedWidth, withoutCol, type ColKey, type ColSizes } from "@/lib/intake/col-widths";

/**
 * This person's column widths for the Leads list: read from browser storage once, kept in memory, written when a resize ends.
 * Storage is a per-viewer convenience (the Weekly review Sheet does the same): a browser that refuses it just uses the defaults.
 * The server and the first client render both use the defaults, so there is no mismatch; the stored widths apply right after.
 */
function read(): ColSizes {
  try {
    return parseColSizes(window.localStorage.getItem(LEADS_COL_WIDTHS_KEY));
  } catch {
    return NO_COL_SIZES;
  }
}
function write(sizes: ColSizes) {
  try {
    if (Object.keys(sizes).length === 0) window.localStorage.removeItem(LEADS_COL_WIDTHS_KEY);
    else window.localStorage.setItem(LEADS_COL_WIDTHS_KEY, JSON.stringify(sizes));
  } catch {
    // Not remembered, and the list still works.
  }
}

let cache: ColSizes | null = null;
const listeners = new Set<() => void>();
const store = {
  get: (): ColSizes => (cache ??= read()),
  server: (): ColSizes => NO_COL_SIZES,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(next: ColSizes) {
    cache = next;
    for (const l of listeners) l();
  },
};

const STEP = 16;

export function useColWidths() {
  const sizes = useSyncExternalStore(store.subscribe, store.get, store.server);
  /** The column being dragged and its real width in px (also for the flexible Next step column), for the width tip. */
  const [drag, setDrag] = useState<{ col: ColKey; width: number } | null>(null);

  /** Drag a column's right edge. The header cell (the handle's parent) is measured when the drag starts. */
  const startDrag = useCallback((col: ColKey) => (event: ReactPointerEvent<HTMLElement>) => {
    const handle = event.currentTarget;
    const cell = handle.parentElement;
    if (!cell) return;
    event.preventDefault();
    const x0 = event.clientX;
    const w0 = cell.getBoundingClientRect().width;
    setDrag({ col, width: Math.round(w0) });
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // No capture (an old browser): the document listeners below still end the drag.
    }
    const onMove = (e: PointerEvent) => {
      const width = resizedWidth(w0, e.clientX - x0);
      store.set({ ...store.get(), [col]: width });
      setDrag({ col, width });
    };
    // One ending for every way a drag can stop: release, cancel (a touch interrupted by the browser) or a lost capture.
    let ended = false;
    const onUp = () => {
      if (ended) return;
      ended = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      handle.removeEventListener("lostpointercapture", onUp);
      setDrag(null);
      write(store.get());
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    handle.addEventListener("lostpointercapture", onUp);
  }, []);

  /** Left and Right change the width by 16px; Home (or a double click) restores the default. */
  const onKeyDown = useCallback((col: ColKey) => (event: ReactKeyboardEvent<HTMLElement>) => {
    const cell = event.currentTarget.parentElement;
    if (event.key === "Home") {
      event.preventDefault();
      const next = withoutCol(store.get(), col);
      store.set(next);
      write(next);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const now = store.get()[col] ?? cell?.getBoundingClientRect().width ?? 0;
    const next = { ...store.get(), [col]: resizedWidth(now, event.key === "ArrowRight" ? STEP : -STEP) };
    store.set(next);
    write(next);
  }, []);

  const reset = useCallback((col: ColKey) => {
    const next = withoutCol(store.get(), col);
    store.set(next);
    write(next);
  }, []);

  return { sizes, drag, startDrag, onKeyDown, reset };
}
