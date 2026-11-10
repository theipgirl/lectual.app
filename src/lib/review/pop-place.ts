/**
 * Where a Sheet popover goes. The table's scroll wrapper clips anything that hangs out of it, so an open popover is
 * drawn `position: fixed` at coordinates worked out here from its cell's box: below the cell when it fits, else above,
 * else wherever shows the most (pinned to the viewport edge). Pure; the DOM wrapper is `components/review/pop-placement.ts`.
 */
export type Box = { top: number; bottom: number; left: number; right: number };
export type Placed = { top: number; left: number; above: boolean };

const MARGIN = 8;
/** The popover overlaps its cell by this much so it reads as attached to it (the CSS used `top: calc(100% - 2px)`). */
const OVERLAP = 2;

export function placePop(anchor: Box, pop: { width: number; height: number }, view: { width: number; height: number }, align: "left" | "right"): Placed {
  const below = anchor.bottom - OVERLAP;
  const aboveTop = anchor.top - pop.height + OVERLAP;
  const fitsBelow = below + pop.height <= view.height - MARGIN;
  const fitsAbove = aboveTop >= MARGIN;
  let top: number;
  let above = false;
  if (fitsBelow) top = below;
  else if (fitsAbove) {
    top = aboveTop;
    above = true;
  } else {
    // Neither fits: pin to the bottom edge of the window (the popover's own list scrolls).
    top = Math.max(MARGIN, view.height - MARGIN - pop.height);
  }
  const wanted = align === "right" ? anchor.right - pop.width : anchor.left + 4;
  const left = Math.max(MARGIN, Math.min(wanted, view.width - MARGIN - pop.width));
  return { top: Math.round(top), left: Math.round(left), above };
}
