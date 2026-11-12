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

/** A signed acceptance (the client signed the engagement letter): the pill and header say so. Unsigned stays "Accepted by client". */
export const SIGNED_STATUS_WORD = "Signed by client";

/** Create-link refusals about the engagement letter copy (Sprint 6). Fixed sentences; nothing of the letter is quoted. */
export const LETTER_CHANGED_SENTENCE = "The firm's engagement letter has changed since this was saved. Save your changes, then create the link again.";
export const LETTER_UNREADABLE_SENTENCE = "Couldn't check the firm's engagement letter. Nothing was changed; try again shortly.";

export const BUTTON_WORDS = {
  createLink: "Save and create link",
  creatingLink: "Creating link…",
  turnOnLink: "Turn on the link",
  turningOnLink: "Turning on…",
  editAgain: "Edit again",
  startNewVersion: "Start a new version",
  withdraw: "Withdraw",
  save: "Save",
  saving: "Saving…",
  preview: "Preview as the client",
} as const;

/** Section and field words of the one-screen editor (design 6.4). */
export const EDITOR_WORDS = {
  selectedToStart: "Selected to start",
  clientDescribes: "Let the client describe this",
  packageForBrand: "Package for this brand",
  discountOnBrand: "Discount on this brand",
  everyBrand: "Use these package options for every brand",
  advancedBrand: "Advanced for this brand",
  advancedPricing: "Advanced pricing",
  readyHeading: "Ready to send?",
  readyNothing: "Nothing is blocking the link.",
  clientPays: "What the client pays",
  pricesUpdateOnSave: "Prices update when you save",
} as const;

/** "Check these 3 things" (assistant drafts). */
export function checkTheseHeading(n: number): string {
  return `Check these ${n} ${n === 1 ? "thing" : "things"}`;
}

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

/** Sprint 3: the editor header's "who made this" line (`content.made_by`). */
export const MADE_WITH_COPILOT = "Made with Copilot";
export const MADE_BY_ASSISTANT = "Made by the assistant";
export function madeByAssistantFrom(date: string): string {
  return `Made by the assistant from the ${date} consult`;
}

/** Sprint 3: the start screen at New proposal (three doors). */
export const START_DOORS = {
  consult: {
    title: "From a consult",
    body: "The assistant drafts a proposal from a consult you have already had, and you review it.",
    notReady: "To draft from a consult, connect Zoom or Fathom first. Until then, start from scratch.",
    connect: "Connect Zoom or Fathom",
    couldntLoad: "Can't show consults right now. Refresh to try again.",
    none: "No consults in the last 14 days.",
  },
  copilot: {
    title: "Ask Copilot",
    body: "Say what you want in a sentence. Copilot opens with the request typed in, and nothing happens until you send it.",
    action: "Ask Copilot",
  },
  scratch: {
    title: "Start from scratch",
    body: "Choose who it is for, and the draft opens in the editor with your firm's packages.",
    action: "Choose who it is for",
  },
} as const;

/** The request typed into Copilot. A name from a chosen lead, else a generic request. Never a price. */
export function copilotRequest(name: string | null): string {
  const who = name?.trim();
  return who ? `Draft a proposal for ${who}` : "Draft a proposal";
}

/** Settings, Proposals: "New proposals offer". */
export const NEW_OFFER_WORDS = {
  heading: "New proposals offer",
  hint: "What a new proposal starts with, from every way of starting one. The client page and the editor can still change it.",
  modeDefault: "One package: the first on the list",
  modeOne: "One package",
  modeChoice: "The client chooses among these packages",
  per: "Choice is made",
  perBrand: "Per brand name",
  perMark: "Per mark",
  options: "Packages offered (up to 3)",
  start: "Starts on",
  tooLarge: "These settings are too large to save. Remove some included items first.",
  tooMany: "Offer at most 3 packages.",
  needsOne: "Pick at least one package to offer.",
} as const;
