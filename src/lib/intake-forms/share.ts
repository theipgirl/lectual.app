/**
 * Can this intake's public link (`/i/<slug>`) be handed out? Only a live form
 * answers there: a draft or archived one is a dead link, so Copy link, the QR
 * code and Preview stay off for it, with the reason beside them. Every place
 * that offers the link asks this, so the list, the editor and the Share panel
 * cannot disagree.
 */
export type IntakeStatus = "draft" | "live" | "archived";

export const NOT_LIVE_MESSAGE = "Not live yet. Publish the form to share it.";

export type ShareState = { canShare: true } | { canShare: false; message: string };

export function shareState(status: IntakeStatus | string): ShareState {
  return status === "live" ? { canShare: true } : { canShare: false, message: NOT_LIVE_MESSAGE };
}
