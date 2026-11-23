/**
 * When the page closes the open signing link because the client changed their choices or details (Sprint A item 17b, v3 B2).
 * A pure reducer: `useLoeFlow` drives it and fires `closeSigningLinkAction` when it says so.
 *   - armed on page load (a link sent from another tab or an earlier visit is closed by the first change);
 *   - a change while armed fires the close and disarms;
 *   - EVERY successful send re-arms (the uncertain answer included);
 *   - a change while a send is in flight is remembered; when that send answers ok the close fires at once (the link just sent was
 *     built from the choices posted at the press) and the state stays disarmed; when it fails nothing more is needed;
 *   - a failed or unreachable close re-arms, so the next change tries again.
 * The page does not compare old and new choices: any change while armed closes.
 */

export type ArmingState = { armed: boolean; sending: boolean; changedDuringSend: boolean };

export type ArmingEvent =
  | { type: "change" }
  | { type: "send_start" }
  | { type: "send_done"; ok: boolean }
  | { type: "close_done"; reached: boolean };

export const INITIAL_ARMING: ArmingState = { armed: true, sending: false, changedDuringSend: false };

export function closeArming(state: ArmingState, event: ArmingEvent): { state: ArmingState; fire: boolean } {
  switch (event.type) {
    case "change":
      if (state.sending) return { state: { ...state, changedDuringSend: true }, fire: false };
      if (state.armed) return { state: { ...state, armed: false }, fire: true };
      return { state, fire: false };
    case "send_start":
      return { state: { ...state, sending: true, changedDuringSend: false }, fire: false };
    case "send_done":
      if (!event.ok) return { state: { ...state, sending: false, changedDuringSend: false }, fire: false };
      if (state.changedDuringSend) return { state: { armed: false, sending: false, changedDuringSend: false }, fire: true };
      return { state: { armed: true, sending: false, changedDuringSend: false }, fire: false };
    case "close_done":
      return { state: event.reached ? state : { ...state, armed: true }, fire: false };
  }
}
