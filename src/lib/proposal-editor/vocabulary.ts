import type { ProposalStatus } from "@/lib/proposals/types";

/**
 * The one place the proposal maker's lifecycle words live (Sprint 27).
 *
 * "Approve" used to sit next to the client's "Accept", and "Mark as sent" suggested
 * something was emailed. Neither is true: the firm's sign-off is internal, and
 * "sent" in the database only means the client link is live. The database statuses
 * and RPCs are unchanged; only the words people read are.
 */

/** Pill wording per stored status. */
export const STATUS_WORDS: Record<ProposalStatus, string> = {
  draft: "Draft",
  approved: "Saved",
  sent: "Link live",
  accepted: "Accepted by client",
  superseded: "Replaced",
  withdrawn: "Withdrawn",
};

export const BUTTON_WORDS = {
  createLink: "Save and create link",
  creatingLink: "Creating link…",
  turnOnLink: "Turn on the link",
  turningOnLink: "Turning on…",
  editAgain: "Edit again",
  startNewVersion: "Start a new version",
  withdraw: "Withdraw",
} as const;

/** `Ask Rebecca or Taylor to create the link`. */
export function askToCreateLink(approvers: string): string {
  return `Ask ${approvers} to create the link`;
}

export const SETTINGS_APPROVERS_HEADING = "Who may create client links";

/** Shown when the first step (saving) worked and the second (turning the link on) did not. */
export const LINK_NOT_TURNED_ON = "Saved, but the link couldn't be turned on. Try again.";
/** Shown on every approved (link not live) version, so a failed link step is explained even after the page re-renders. */
export const LINK_NOT_LIVE_YET = "Saved, but the link isn't live yet. Turn on the link to finish.";
export const LINK_CREATED = "Link created. It is live now.";
export const LINK_TURNED_ON = "The link is live now.";
export const EDIT_AGAIN_DONE = "Back to editing.";

/** Timeline lines for the status events (events.ts). */
export const EVENT_WORDS = {
  approved: "saved it",
  unapproved: "took it back to editing",
  unapprovedByEdit: "edited it after it was saved, so it went back to draft",
  sent: "turned on the client link (nothing was emailed from here)",
  superseded: "turned on a newer version, which replaced this one",
} as const;
