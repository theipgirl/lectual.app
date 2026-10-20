/**
 * How the navigation rail lets go of focus. The rail opens on hover and on
 * keyboard focus (`:has(:focus-visible)`), and a click on a link or the pin
 * must not leave focus inside it. These are plain functions over small
 * interfaces so they run without a DOM; Rail.tsx passes the real elements.
 */

type Blurrable = { blur(): void };
type Container = { contains(node: unknown): boolean };

/** Drops focus from the clicked rail control (a link or the pin button). */
export function releaseRailFocus(active: Blurrable | null | undefined): void {
  active?.blur();
}

/**
 * Escape closes the rail by blurring whatever has focus inside it. Returns
 * true when it did, so the caller knows the key was used. Any other key, or
 * focus outside the rail, is left alone.
 */
export function closeRailOnEscape(key: string, rail: Container, active: Blurrable | null | undefined): boolean {
  if (key !== "Escape" || !active || !rail.contains(active)) return false;
  active.blur();
  return true;
}
