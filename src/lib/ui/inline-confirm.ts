export type ConfirmState = "idle" | "asking";
export type ConfirmEvent = "ask" | "confirm" | "cancel";

/**
 * The inline confirm's two states. Confirm is the ONLY event that acts (`fire`); Cancel and a repeated Ask
 * change nothing. Pure, so a test can pin that Cancel never fires.
 */
export function nextConfirm(state: ConfirmState, event: ConfirmEvent): { state: ConfirmState; fire: boolean } {
  if (event === "ask") return { state: "asking", fire: false };
  if (state !== "asking") return { state: "idle", fire: false };
  return { state: "idle", fire: event === "confirm" };
}
