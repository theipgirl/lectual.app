import { nextTabFocus } from "@/lib/copilot/launcher";

/**
 * Editor fixes (2026-11-12): the keyboard of the full-width client preview (`ExpandablePreview`). Pure, so it is
 * tested without a browser. Esc closes; Tab and Shift+Tab wrap inside the dialog (only at its two ends: in between
 * the browser moves focus as usual).
 */
export type ExpandKeyAction = { kind: "close" } | { kind: "focus"; index: number };

export function expandKeyAction(e: { key: string; shiftKey?: boolean }, focus: { count: number; current: number }): ExpandKeyAction | null {
  if (e.key === "Escape") return { kind: "close" };
  if (e.key === "Tab") {
    const index = nextTabFocus({ count: focus.count, current: focus.current, shift: !!e.shiftKey });
    return index === null ? null : { kind: "focus", index };
  }
  return null;
}

/**
 * Locks every element that can scroll the page behind the dialog (the dashboard scrolls `.lx-page`, not the window)
 * and returns the function that puts each one back exactly as it was.
 */
export function lockScroll(targets: readonly ({ style: { overflow: string } } | null | undefined)[]): () => void {
  const held = targets.filter((t): t is { style: { overflow: string } } => !!t).map((t) => ({ t, before: t.style.overflow }));
  for (const h of held) h.t.style.overflow = "hidden";
  return () => {
    for (const h of held) h.t.style.overflow = h.before;
  };
}
