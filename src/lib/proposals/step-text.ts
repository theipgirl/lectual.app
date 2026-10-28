/**
 * The sentences the Sprint 19 steps give as their reason, in one place. The flow writes
 * them onto the proposal's timeline and the page prints them as they are, so a sentence
 * exists once and the page, the history and the action's confirmation cannot drift apart.
 *
 * Pure and client-safe. None of them carries a name, an amount or an id.
 */

export const STEP_TEXT = {
  alreadyQueued: "An engagement letter draft is already in the queue for this proposal.",
  documentCenterOff: "Document Center isn't switched on for this firm.",
  noMatter: "Open the matter to draft the LOE.",
  manyMatters: "More than one matter is linked to this client. Draft the LOE from the right matter.",
  mattersUnreadable: "Couldn't read the matters linked to this client, so no engagement letter was drafted.",
  draftsUnreadable: "Couldn't check for an earlier engagement letter draft, so none was made.",
  draftFailed: "The engagement letter draft couldn't be made. Try again shortly.",
  matterNotLinked: "This matter isn't linked to Lawmatics yet.",
  unverifiedShape: "The shape of this request hasn't been checked against a live account.",
  noStoredLoe: "The engagement letter hasn't been approved and stored yet, so there is no file to upload.",
  noDraftToRetry: "No engagement letter draft was queued for this proposal, so there is no file to upload.",
  fieldsNoMapping: "The LOE fields are switched on, but none of the six names is matched to a Lawmatics field yet.",
  fieldsNotWritten: "Not written to Lawmatics",
  alreadyPaid: "This proposal is already marked paid.",
  alreadyUploaded: "The accepted proposal is already uploaded to Lawmatics.",
  alreadyWritten: "The LOE fields are already written to Lawmatics.",
  alreadyNoted: "The acceptance note is already in Lawmatics.",
  followupsNotStarted: "Marked paid, but the follow-up steps couldn't start. Undo the paid mark and mark it paid again to run them.",
  eventNotRecorded: "The step ran, but its line on the timeline couldn't be saved.",
} as const;

/** Why a Lawmatics write could not start, in the words of what it would have done ("uploaded", "written"). */
export const accessText = (did: "uploaded" | "written") =>
  ({
    noMatter: `There is no matter yet, so nothing was ${did}. Open the matter first.`,
    manyMatters: `More than one matter is linked to this client, so nothing was ${did}.`,
    mattersUnreadable: `Couldn't read the matters linked to this client, so nothing was ${did}.`,
    notConnected: `Lawmatics isn't connected, so nothing was ${did}.`,
    connectionUnreadable: `Couldn't check the Lawmatics connection, so nothing was ${did}.`,
  }) as const;

/** "Not uploaded to Lawmatics: HTTP 422. The shape of this request hasn't been checked against a live account." */
export function notUploadedText(reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, "");
  return `Not uploaded to Lawmatics: ${why}. ${STEP_TEXT.unverifiedShape}`;
}

/** The same for the LOE fields write (same unverified-shape caution). */
export function notWrittenText(reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, "");
  return `${STEP_TEXT.fieldsNotWritten}: ${why}. ${STEP_TEXT.unverifiedShape}`;
}

export const MARK_PAID_WORDS = {
  byHand: "Marked by hand. LawPay isn't connected to proposals yet.",
  unreadable: "Paid status couldn't be read",
  unreadableHelp: "Can't show whether this was paid right now. Refresh to try again.",
  notAllowed: "Only owners, admins, senior admins and intake staff can mark a proposal paid or undo it.",
  markedNotice: "Marked paid.",
  undoneHeadline: "Paid mark undone.",
  undoneNotice: "The engagement letter draft, if one was queued, stays in the approval queue.",
} as const;
