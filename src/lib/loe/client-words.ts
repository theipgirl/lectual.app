/**
 * Every client-facing word the engagement-letter steps add to the proposal page, in one place.
 *
 * ── WHO WRITES WHAT ─────────────────────────────────────────────────────────────────────────────
 * The software's builders write only words that NAME A STEP or SAY WHAT THE PAGE DID: button labels, headings, "saved with
 * your acceptance", "nothing has been signed". They never write a sentence about what a letter, a signature or this page
 * means in law. That text is the firm's attorney's to write.
 *
 *  - The pay notes (`PAYNOTE_*`) only describe the steps. They stand where the no-letter page says the agreement is sent
 *    after payment (which is not true of a proposal signed on this page). The attorney should still read them.
 *  - The footer on a proposal that carries a letter is the firm's EXISTING footer line, unchanged: the same one every
 *    proposal without a letter shows. `ATTORNEY_FOOTER_LETTER_LINE` below is an UNSET slot (null) for the attorney's own
 *    replacement; the page uses it only once an attorney has written it here.
 *  - The right-hand panel shows NO commitment sentence on a letter proposal: the letter and the "I have read and agree"
 *    tick are the commitment, and nothing written here stands in for them.
 *
 * Nothing else in the app edits this file; change the wording here only. Lectual's own line ("software, not a law firm",
 * `NOT_A_LAW_FIRM_DISCLAIMER`) is unchanged and stays on every state.
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
/** The letter is dated by the server at the moment of signing (the firm's calendar date), so the intro says so rather than "today's date". */
export const LETTER_INTRO = "Please read the whole letter and the exhibit that follows it. Your details are filled in, and the letter is dated the day you sign it.";

export const SIGN_HEADING = "Sign";
export const SIGN_NAME_LABEL = "Type your full legal name to sign";
export const SIGN_AGREE_LABEL = "I have read and agree to this engagement letter";
export const SIGN_RECORDING_NOTICE =
  "When you sign, we record your typed name, the date and time, your device's network address and browser details, and the exact text of this letter and its exhibit.";

export const DOWNLOAD_REVIEW_LABEL = "Download the letter (PDF)";
export const DOWNLOAD_SIGNED_LABEL = "Download your signed letter (PDF)";
export const READ_AGAIN_LABEL = "Read it again";
export const REVIEW_COPY_MARK = "Review copy - not yet signed";

/** Shown before signing, beside the total. Describes the steps only. */
export const PAYNOTE_BEFORE_SIGNING = "You will read and sign the engagement letter before you pay. Your signed copy is saved with your acceptance.";
/** Shown on the receipt. Describes what happened only. */
export const PAYNOTE_AFTER_SIGNING = "Your signed engagement letter is saved with your acceptance.";
/** Added to the receipt's note ONLY when the download button is drawn above it, so it is never said without the button. */
export const PAYNOTE_DOWNLOAD_ABOVE = "You can download it above.";

/**
 * The attorney's own footer line for a proposal that carries a letter. UNSET (null): until the firm's attorney writes one here,
 * such a proposal shows the firm's existing footer line, exactly as a proposal without a letter does. Software builders do not
 * write this sentence.
 */
export const ATTORNEY_FOOTER_LETTER_LINE: string | null = null;

/** Fixed refusals the sign step shows (never raw error text). */
export const SIGN_MESSAGES = {
  details_required: "Please fill in your full legal name and your address before continuing.",
  name_required: "Please type your full legal name to sign.",
  agree_required: "Please tick the box to confirm you have read and agree to the letter.",
  // Only ever shown when the proposal itself changed after this page was opened (the date and how a name is spaced never cause it).
  stale: "This proposal was updated after you opened this page. Please reload the page to see the current version and review the letter again. Nothing has been signed.",
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
