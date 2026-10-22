import { nextTabFocus } from "@/lib/copilot/launcher";
import type { TourOutcome, TourSide } from "./tour";

/**
 * The tour's behaviour, kept pure so it is tested without a browser: the step
 * reducer, the key handler, where the popover sits, whether a target can be
 * spotlighted, whether the tour opens on load, and how it closes.
 */

export const GUARD_KEY = "lectual_tour_guard";
export const MIN_SPOTLIGHT_WIDTH = 768;
export const SPOT_PADDING = 6;
export const VIEWPORT_MARGIN = 8;
export const POPOVER_GAP = 12;

// ── steps ──────────────────────────────────────────────────────────────

export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

export type StepAction = "next" | "back" | "skip";
export type StepResult = { index: number; outcome: TourOutcome | null };

/** `next` on the last step finishes; `skip` ends as skipped; the index never leaves 0..count-1. */
export function stepTour(state: { index: number; count: number }, action: StepAction): StepResult {
  const index = clampIndex(state.index, state.count);
  if (action === "skip") return { index, outcome: "skipped" };
  if (action === "back") return { index: clampIndex(index - 1, state.count), outcome: null };
  if (index >= state.count - 1) return { index, outcome: "finished" };
  return { index: index + 1, outcome: null };
}

// ── keys ───────────────────────────────────────────────────────────────

export type TourKeyEvent = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Focus is in an input, textarea, select or editable element. */
  inField?: boolean;
};

export type TourKeyAction =
  | { kind: StepAction; preventDefault: true }
  | { kind: "focus"; index: number; preventDefault: true };

/** Escape skips, arrows move, Tab wraps inside the popover. Anything else is null: not handled, not prevented. */
export function tourKeyAction(e: TourKeyEvent, focus: { count: number; current: number }): TourKeyAction | null {
  if (e.key === "Escape") return { kind: "skip", preventDefault: true };
  if (e.key === "Tab") {
    const index = nextTabFocus({ count: focus.count, current: focus.current, shift: !!e.shiftKey });
    return index === null ? null : { kind: "focus", index, preventDefault: true };
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.inField) return null;
    return { kind: e.key === "ArrowRight" ? "next" : "back", preventDefault: true };
  }
  return null;
}

// ── placement ──────────────────────────────────────────────────────────

export type Rect = { top: number; left: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type Size = { width: number; height: number };

export type Placement =
  | { mode: "center" }
  | { mode: "spot"; cutout: Rect; popover: { top: number; left: number; side: TourSide } };

/** Reads an element's box without ever throwing; null for a missing element or a missing/odd measurement. */
export function measureTarget(el: { getBoundingClientRect?: () => Rect } | null | undefined): Rect | null {
  try {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const r = el.getBoundingClientRect();
    if (!r) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

function finiteRect(r: Rect): boolean {
  return [r.top, r.left, r.width, r.height].every((n) => typeof n === "number" && Number.isFinite(n));
}

/** A target can be spotlighted only when it has size, is on screen, and the viewport is wide enough. */
export function canSpotlight(rect: Rect | null, viewport: Viewport): boolean {
  if (!rect || !finiteRect(rect)) return false;
  if (!(viewport.width >= MIN_SPOTLIGHT_WIDTH) || !(viewport.height > 0)) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  const offLeft = rect.left + rect.width <= 0;
  const offRight = rect.left >= viewport.width;
  const offTop = rect.top + rect.height <= 0;
  const offBottom = rect.top >= viewport.height;
  return !(offLeft || offRight || offTop || offBottom);
}

const OPPOSITE: Record<TourSide, TourSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, Math.max(min, max)));
}

function positionOn(side: TourSide, cut: Rect, size: Size, viewport: Viewport): { top: number; left: number; fits: boolean } {
  const m = VIEWPORT_MARGIN;
  let top: number;
  let left: number;
  let fits: boolean;
  if (side === "left" || side === "right") {
    left = side === "right" ? cut.left + cut.width + POPOVER_GAP : cut.left - POPOVER_GAP - size.width;
    top = cut.top;
    fits = left >= m && left + size.width <= viewport.width - m;
  } else {
    top = side === "bottom" ? cut.top + cut.height + POPOVER_GAP : cut.top - POPOVER_GAP - size.height;
    left = cut.left;
    fits = top >= m && top + size.height <= viewport.height - m;
  }
  return {
    top: clamp(top, m, viewport.height - size.height - m),
    left: clamp(left, m, viewport.width - size.width - m),
    fits,
  };
}

/** Where the spotlight and popover go, or a centered card when the target cannot be used. */
export function placePopover(input: { rect: Rect | null; viewport: Viewport; size: Size; side?: TourSide }): Placement {
  const { rect, viewport, size } = input;
  if (!canSpotlight(rect, viewport) || !rect) return { mode: "center" };
  const pad = SPOT_PADDING;
  const cutout: Rect = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const preferred = input.side ?? "bottom";
  for (const side of [preferred, OPPOSITE[preferred]]) {
    const p = positionOn(side, cutout, size, viewport);
    if (p.fits) return { mode: "spot", cutout, popover: { top: p.top, left: p.left, side } };
  }
  const p = positionOn(preferred, cutout, size, viewport);
  return { mode: "spot", cutout, popover: { top: p.top, left: p.left, side: preferred } };
}

// ── open on load ───────────────────────────────────────────────────────

/** Opens only when the server said "not seen", this browser session has not already closed it, and no modal is up. */
export function shouldOpenOnLoad(input: { open: boolean; guard: boolean; modalOpen: boolean }): boolean {
  return input.open && !input.guard && !input.modalOpen;
}

type ModalLike = { hidden?: boolean; closest?: (selector: string) => unknown };

/** A visible modal: `[aria-modal="true"]` that is not hidden and not inside a `[hidden]` ancestor (the Copilot drawer is mounted hidden). */
export function hasVisibleModal(root: { querySelectorAll: (selector: string) => Iterable<ModalLike> } | null | undefined): boolean {
  try {
    if (!root) return false;
    for (const el of root.querySelectorAll('[aria-modal="true"]')) {
      if (el.hidden) continue;
      if (typeof el.closest === "function" && el.closest("[hidden]")) continue;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ── focus ──────────────────────────────────────────────────────────────

type FocusLike = { focus?: () => void; isConnected?: boolean };

/** The element to give focus back to on close: the one focused at open, if it is still in the page. */
export function focusRestoreTarget<T extends FocusLike>(el: T | null | undefined): T | null {
  if (!el || typeof el.focus !== "function") return null;
  if (el.isConnected === false) return null;
  return el;
}

// ── closing ────────────────────────────────────────────────────────────

type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

export function readGuard(storage: StorageLike | null | undefined): boolean {
  try {
    return !!storage && storage.getItem(GUARD_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Closes the tour at once, sets the session guard, then saves the outcome. The
 * save never blocks or traps anyone: a rejection, a failure result or storage
 * that throws is swallowed, and nothing from the error is returned. The flag
 * stays unwritten after a failure, so a later sign-in can show the tour again.
 */
export async function closeTour(input: {
  outcome: TourOutcome;
  action: (outcome: TourOutcome) => Promise<unknown>;
  storage: StorageLike | null | undefined;
  onClosed: () => void;
}): Promise<void> {
  input.onClosed();
  try {
    input.storage?.setItem(GUARD_KEY, "1");
  } catch {
    // Private mode: the tour is already closed for this page view.
  }
  try {
    await input.action(input.outcome);
  } catch {
    // Not saved; it may show again on a later sign-in.
  }
}
