import type { LoginState } from "./actions";

/** `round` changes on every successful send; `sends` counts sends to the CURRENT address only. */
export type SentState = LoginState & { sends?: number; round?: number };

/**
 * Folds one send result into the on-screen state. Only a successful RESEND of the same address
 * (the confirmation's own form) counts as "sent again"; a first send to a new or re-typed address
 * starts from 1, so "Sent again." never shows for it.
 */
export function nextSentState(prev: SentState, result: LoginState, isResend: boolean): SentState {
  // A refused resend keeps the confirmation on screen and shows its sentence there.
  if (!result.ok && prev.ok) return { ...prev, error: result.error };
  if (!result.ok) return { ...result, sends: prev.sends, round: prev.round };
  const again = isResend && prev.ok === true && prev.email === result.email;
  return { ...result, sends: again ? (prev.sends ?? 1) + 1 : 1, round: (prev.round ?? 0) + 1 };
}
