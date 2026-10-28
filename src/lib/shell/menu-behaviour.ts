/**
 * When a popup menu (the account menu, the phone More sheet) closes. Plain
 * functions over small interfaces so they run without a DOM; the components
 * pass the real events and elements.
 */

type Container = { contains(node: unknown): boolean };

/** Escape closes an open menu, and focus goes back to the control that opened it. */
export function menuKeyAction(key: string, open: boolean): "close" | null {
  return open && key === "Escape" ? "close" : null;
}

/** A press outside the menu's own container closes it. A press with no known target is treated as outside. */
export function isOutsidePress(container: Container | null | undefined, target: unknown): boolean {
  if (!container) return false;
  return !target || !container.contains(target);
}
