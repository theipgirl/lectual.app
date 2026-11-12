/**
 * Every client-facing word the engagement-letter steps add to the proposal page, in one place.
 *
 * ── ATTORNEY MUST APPROVE BEFORE USE ────────────────────────────────────────────────────────────
 * The sentences marked "REPLACEMENT" below stand in for two sentences that must not appear on a proposal that carries
 * an engagement letter (design doc 4.7):
 *   1. "Once your payment is received, we'll send your engagement agreement for review and signature."
 *   2. The footer line that the page "does not ... create an attorney-client relationship".
 * They are placeholders written by the software's builders, NOT by a lawyer. The firm's attorney must read and approve
 * (or replace) each one before a client sees it. Nothing else in the app edits this file; change the wording here only.
 * Lectual's own line ("software, not a law firm", `NOT_A_LAW_FIRM_DISCLAIMER`) is unchanged and stays on every state.
 */

export const STEP_NAMES = ["Choose", "Your details", "Engagement letter", "Pay"] as const;

export const READ_LETTER_FIRST = "Read the engagement letter first";
export const SEE_INCLUDES_LINK = "See what each package includes";

/** Button labels (design doc 4.7). */
export const CONTINUE_LABEL = "Continue";
export const SIGN_LABEL = "Sign and continue to payment";
export const PAY_LABEL = "Pay my legal fee";
export const BACK_LABEL = "Back";

export const DETAILS_HEADING = "Your details";
export const DETAILS_INTRO = "These go on your engagement letter. Please give your full legal name and the address where the firm can write to you.";
export const LETTER_HEADING = "Your engagement letter";
export const LETTER_INTRO = "Please read the whole letter and the exhibit that follows it. Your details and today's date are filled in.";

export const SIGN_HEADING = "Sign";
export const SIGN_NAME_LABEL = "Type your full legal name to sign";
export const SIGN_AGREE_LABEL = "I have read and agree to this engagement letter";
export const SIGN_RECORDING_NOTICE =
  "When you sign, we record your typed name, the date and time, your device's network address and browser details, and the exact text of this letter and its exhibit.";

export const DOWNLOAD_REVIEW_LABEL = "Download the letter (PDF)";
export const DOWNLOAD_SIGNED_LABEL = "Download your signed letter (PDF)";
export const READ_AGAIN_LABEL = "Read it again";
export const REVIEW_COPY_MARK = "Review copy - not yet signed";

/** REPLACEMENT for 4.7 sentence 1 (shown before signing, beside the total). Attorney must approve. */
export const PAYNOTE_BEFORE_SIGNING = "You will read and sign the engagement letter before you pay. Your signed copy is saved with your acceptance.";
/** REPLACEMENT for 4.7 sentence 1 (shown on the receipt). Attorney must approve. */
export const PAYNOTE_AFTER_SIGNING = "Your signed engagement letter is saved with your acceptance. You can download it above.";
/** REPLACEMENT for 4.7 sentence 2 (the footer line on a proposal that carries a letter). Attorney must approve. */
export const FOOTER_LETTER_LINE =
  "Attorney advertising. This page is prepared for discussion purposes. The engagement letter on this page is an agreement between you and the firm only once you have signed it.";

/** Fixed refusals the sign step shows (never raw error text). */
export const SIGN_MESSAGES = {
  details_required: "Please fill in your full legal name and your address before continuing.",
  name_required: "Please type your full legal name to sign.",
  agree_required: "Please tick the box to confirm you have read and agree to the letter.",
  stale: "This page changed while you were reading it. Please reload the page and review the letter again. Nothing has been signed.",
  letter_unavailable: "We couldn't prepare your engagement letter just now. Nothing has been signed. Please try again, or contact the firm.",
  not_ready: "Signing isn't available on this page yet. Nothing has been signed. Please contact the firm.",
  signing_required: "This proposal has an engagement letter. Please review and sign it to continue.",
  generic: "We couldn't record your signature. Please try again.",
} as const;

export const PDF_MESSAGES = {
  unavailable: "We couldn't prepare the PDF just now. Please try again.",
  not_open: "This proposal is no longer open.",
  limit: "Too many downloads just now. Please wait a few minutes and try again.",
  details: "Please fill in your full legal name and your address first.",
  not_signed: "There is no signed letter to download.",
} as const;
