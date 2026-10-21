import { isCopilotPath } from "./context";

/**
 * The decisions behind the floating copilot button, kept pure so they can be
 * tested without a browser: where it shows, what the keyboard does, and how Tab
 * wraps inside the open drawer.
 */

/** Hidden on the copilot page itself (it IS the copilot) and wherever AI isn't configured. */
export function shouldShowLauncher(input: { pathname: string | null; configured: boolean }): boolean {
  if (!input.configured) return false;
  return !isCopilotPath(input.pathname ?? "");
}

export type LauncherKeyEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean };

/**
 * The next open state for a key press, or null when the key means nothing here.
 * Command-J (Ctrl-J elsewhere) toggles and takes the key from the browser;
 * Escape closes an open drawer and does nothing otherwise. Never acts while the
 * launcher isn't active (copilot page, AI not configured).
 */
export function launcherKeyAction(
  e: LauncherKeyEvent,
  state: { active: boolean; open: boolean },
): { open: boolean; preventDefault: boolean } | null {
  if (!state.active) return null;
  if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey) && !e.altKey) {
    return { open: !state.open, preventDefault: true };
  }
  if (e.key === "Escape" && state.open) return { open: false, preventDefault: false };
  return null;
}

/**
 * Which focusable to move to for a Tab press inside the drawer, or null to let
 * the browser move focus itself. `current` is the focused element's index among
 * the drawer's focusables (-1 when focus is somewhere outside it).
 */
export function nextTabFocus(input: { count: number; current: number; shift: boolean }): number | null {
  const { count, current, shift } = input;
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

type Focusable = { focus: () => void };

/** Moves focus to the drawer's input (the first control a person types in). */
export function focusFirstInput(root: { querySelector: (selector: string) => Focusable | null } | null): boolean {
  const input = root?.querySelector("input, textarea");
  if (!input) return false;
  input.focus();
  return true;
}

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
