import { SHOW_FEEDBACK_EVENT } from "./constants";

type Dispatcher = { dispatchEvent: (event: Event) => boolean };
export type OpenerLike = { focus?: () => void; isConnected?: boolean };

/** Asks the one dashboard dialog to open. `opener` is where focus returns on close. */
export function requestFeedback(target: Dispatcher, opener: OpenerLike | null): void {
  target.dispatchEvent(new CustomEvent(SHOW_FEEDBACK_EVENT, { detail: { opener } }));
}

export function openerFrom(event: Event): OpenerLike | null {
  const detail = (event as CustomEvent<{ opener?: OpenerLike | null }>).detail;
  return detail?.opener ?? null;
}
