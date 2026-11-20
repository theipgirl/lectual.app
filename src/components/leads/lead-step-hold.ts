/**
 * The 5-second hold before a Yes on the lead page is posted, as a pure reducer (the approval deck's rule, written once
 * more here because the deck keeps its timer inside its own component). Nothing is posted while it counts: Undo, or
 * closing the tab, leaves the card exactly as it was. `fire` is true on the one tick that ends the hold; Undo never fires.
 */
export type HoldState = { holding: number | null };
export type HoldEvent = "start" | "tick" | "undo";

export const holdSeconds = (ms: number): number => Math.max(1, Math.round(ms / 1000));

export function nextHold(state: HoldState, event: HoldEvent, seconds: number): { state: HoldState; fire: boolean } {
  if (event === "start") return state.holding === null ? { state: { holding: seconds }, fire: false } : { state, fire: false };
  if (event === "undo") return { state: { holding: null }, fire: false };
  if (state.holding === null) return { state, fire: false };
  const left = state.holding - 1;
  return left > 0 ? { state: { holding: left }, fire: false } : { state: { holding: null }, fire: true };
}
