/**
 * Pure keyboard rules for the one dialog and the one side panel (no DOM, so they are tested without one, like the tour's
 * `tourKeyAction`). The component reads the DOM, asks this what to do, and does it.
 */
export type DialogKeyEvent = { key: string; shiftKey?: boolean; defaultPrevented?: boolean };
export type DialogKeyAction =
  | { kind: "close"; preventDefault: true }
  | { kind: "focus"; index: number; preventDefault: true }
  | null;

/** `current` is the index of the focused item among `count` focusable items, or -1 when focus is on the dialog itself or outside. */
export function dialogKeyAction(
  e: DialogKeyEvent,
  focus: { count: number; current: number },
  options: { handleEsc?: boolean } = {},
): DialogKeyAction {
  const { handleEsc = true } = options;
  // A key something inside the dialog already handled (a menu's Esc closes the menu, not the dialog around it).
  if (e.defaultPrevented) return null;
  if (e.key === "Escape") return handleEsc ? { kind: "close", preventDefault: true } : null;
  if (e.key !== "Tab") return null;
  if (focus.count === 0) return null;
  const last = focus.count - 1;
  if (e.shiftKey) {
    if (focus.current <= 0) return { kind: "focus", index: last, preventDefault: true };
    return null;
  }
  if (focus.current === last) return { kind: "focus", index: 0, preventDefault: true };
  if (focus.current < 0) return { kind: "focus", index: 0, preventDefault: true };
  return null;
}

/** The one place the close control, Esc and the backdrop agree: which dialog sizes exist, and the class each draws. */
export type DialogSize = "sm" | "md" | "lg";
export function dialogClass(size: DialogSize = "md", className?: string): string {
  return `lx-modal lx-modal-${size}${className ? ` ${className}` : ""}`;
}

/**
 * A menu inside a dialog: Esc closes the MENU and nothing else. The menu claims the key (preventDefault + stopPropagation,
 * in the capture phase so it runs before the dialog's own listener), and `dialogKeyAction` ignores a claimed key.
 */
export function popoverClaimsKey(e: { key: string; defaultPrevented?: boolean }, open: boolean): boolean {
  return open && e.key === "Escape" && !e.defaultPrevented;
}
