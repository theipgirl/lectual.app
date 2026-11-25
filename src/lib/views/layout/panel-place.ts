/**
 * Where a fixed menu panel goes, from its trigger button's box, so every item can be reached without scrolling the page (a page
 * scroll closes these panels). It opens below the button when there is room (or when there is more room below than above),
 * otherwise above it; either way its max height is the space on that side, and the panel scrolls inside itself. Pure.
 */
export type PanelPlace = { left: number; maxHeight: number } & ({ top: number } | { bottom: number });

/** Below this much room the panel flips above the button if there is more room there. */
export const PANEL_MIN_ROOM = 280;
const GAP = 4;
const EDGE = 8;

export function panelPlace(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
  panelWidth: number,
): PanelPlace {
  const left = Math.max(EDGE, Math.min(rect.left, viewport.width - panelWidth - EDGE));
  const below = viewport.height - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  if (below >= PANEL_MIN_ROOM || below >= above) {
    return { top: rect.bottom + GAP, left, maxHeight: Math.max(120, below) };
  }
  return { bottom: viewport.height - rect.top + GAP, left, maxHeight: Math.max(120, above) };
}
