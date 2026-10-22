import { FEEDBACK_MAX_CHARS, FEEDBACK_MESSAGES, type FeedbackType } from "./constants";
import type { FeedbackResult } from "./submit";

/** The dialog's state and the decisions on it, pure so they are tested without a browser. */
export type DialogState = {
  type: FeedbackType;
  description: string;
  status: "idle" | "sending" | "sent";
  error: string | null;
};

export const initialDialogState = (): DialogState => ({ type: "bug", description: "", status: "idle", error: null });

export function canSend(s: DialogState): boolean {
  return s.status === "idle" && s.description.trim().length > 0 && s.description.length <= FEEDBACK_MAX_CHARS;
}

/** Marks the dialog as sending, or null when a send must not start (already sending, empty). A second click gets null. */
export function beginSend(s: DialogState): DialogState | null {
  return canSend(s) ? { ...s, status: "sending", error: null } : null;
}

/** The state after the action answered. A thrown action reads as the fixed failure sentence; the text is kept. */
export async function finishSend(s: DialogState, send: () => Promise<FeedbackResult>): Promise<DialogState> {
  try {
    const r = await send();
    if (r.ok) return { ...s, status: "sent", error: null };
    return { ...s, status: "idle", error: r.error };
  } catch {
    return { ...s, status: "idle", error: FEEDBACK_MESSAGES.failed };
  }
}

/** Escape closes (unless a send is in flight). */
export function shouldCloseOnKey(key: string, s: DialogState): boolean {
  return key === "Escape" && s.status !== "sending";
}
