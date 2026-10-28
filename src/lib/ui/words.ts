// The glossary: ONE name per thing, as a firm sees it. Every firm-facing string that
// names one of these things imports it from here (tests/ui/words.test.ts and
// tests/ui/no-build-words.test.ts hold that line). Pure: no imports from components.
// URLs, slugs, data-tour tokens, anchors, DB values and agent ids keep their old names;
// only the words a person reads change.

/** Ask questions of the firm's own data (the floating button and the page). */
export const COPILOT_NAME = "Copilot";
/** The background helpers that read, summarise and draft (was "Agents"). */
export const ASSISTANTS_NAME = "Assistants";
/** Staff-run tasks on a chosen record (was "Skills"). */
export const SHORTCUTS_NAME = "Shortcuts";
/** What the firm has told Lectual about how it works (was "Firm brain"). */
export const FIRM_NOTES_NAME = "Firm notes";
/** The rail group holding Copilot, Assistants, Shortcuts and Firm notes (was "IP.OS"). */
export const AI_TOOLS_GROUP = "AI tools";
/** Drafts waiting for a person's OK (was "Queue"). */
export const APPROVALS_NAME = "Approvals";
/** The people who have asked about work (was "Intake" / "PNC"). */
export const LEADS_NAME = "Leads";
/** The rail group that holds Leads and the intake forms. */
export const LEADS_GROUP = "Leads";
/** Matters whose next step is the firm's (was "Our move"). */
export const OUR_TURN = "Our turn";
/** Hot, warm or cold (was "lane"). */
export const TEMPERATURE_NAME = "Temperature";
/** No hot/warm/cold level set or suggested (was "Not routed"). */
export const NOT_RATED = "Not rated";
/** A lead the system moved on its own (was "Moved by agent" / "Agent moves"). */
export const MOVED_AUTOMATICALLY = "Moved automatically";
/** The button that copies the address of the current filtered list (was "Save this view"). */
export const COPY_VIEW_LINK = "Copy link to this view";
export const COPIED = "Copied";
/** Lead-page cards. */
export const FROM_THEIR_EMAILS = "From their emails";
export const AUTOMATIC_STAGE_MOVES = "Automatic stage moves";
export const FIRST_READ = "First read of this lead";
/** The firm-wide pause (was "Autopilot paused"). */
export const ASSISTANTS_PAUSED = "Assistants paused";
/** Settings tab for the parts of Lectual switched on firm by firm (was "Modules"). */
export const FEATURES_NAME = "Features";
export const FEATURES_SUBLINE =
  "Parts of Lectual that are switched on firm by firm. To add one, contact Lectual and we'll set it up with you.";

/** The Leads list temperature filter tooltip. */
export const TEMPERATURE_TOOLTIP =
  "Hot, warm or cold: the level you set, or the system's suggestion if you haven't set one.";

/** The sentence for anything Lectual has to switch on. Platform issues are Lectual's, never "an administrator". */
export const NOT_SWITCHED_ON = "This isn't switched on for your firm yet. Lectual will turn it on.";
export function notReadyYet(feature?: string): string {
  const name = feature?.trim();
  return name ? `${name} isn't switched on for your firm yet. Lectual will turn it on.` : NOT_SWITCHED_ON;
}

/** A read that failed. The state logic stays: a failed read is never drawn as empty or zero. */
export const CANT_SHOW = "Can't show this right now. Refresh to try again.";
export function cantShow(what: string): string {
  return `Can't show ${what} right now. Refresh to try again.`;
}
/** A server problem the firm cannot fix. */
export const LECTUAL_TOLD = "Lectual has been told and is looking into it.";

/** Shown when a firm owner or admin must act (a firm issue, not a platform one). */
export const ASK_OWNER_OR_ADMIN = "an owner or admin at your firm";

/** Feedback dialog disclosure. */
export const FEEDBACK_DISCLOSURE =
  "We'll include your note and a list of the pages you visited and any errors, to help us fix it. We don't include client information.";

/** Sign-in. */
export const SIGN_IN_EXPIRED = "That sign-in link has expired or was already used. Enter your email to get a new one.";
export const SIGN_IN_GENERIC = "We couldn't send the link. Check the address and try again.";
export const SIGN_IN_ERROR_FALLBACK = "That sign-in didn't work. Enter your email to get a new link.";

/** Plain permission wording (was "scope"). */
export const NEEDS_CALENDAR_PERMISSION = "Needs permission to read the calendar. Reconnect.";
export const NEEDS_MAIL_PERMISSION = "Needs permission to read mail. Reconnect.";

/** Leads list. */
export const LEADS_LOAD_FAILED_TITLE = "Can't show your leads right now.";
export const LEADS_LOAD_FAILED_BODY = "Can't show your leads right now. Refresh to try again.";
export const NO_LEAD_STAGES = "Your lead stages haven't been set up yet. An owner or admin can add them in Settings.";
export const NO_LEADS_YET = "No leads yet. New enquiries from your intake form appear here.";
export const NO_LEAD_MATCHES = "No lead matches these filters.";
export const PIPELINE_VIEW_ONLY = "This is a view-only overview. To move a lead, open it in Leads.";
/** The plural of the same sentence, for labels like "Results" or "Event assessments". */
export function notReadyPlural(features: string): string {
  return `${features.trim()} aren't switched on for your firm yet. Lectual will turn them on.`;
}
/** LawPay's card payments are Lectual's to switch on; until then the firm records payments by hand. */
export const LAWPAY_NOT_ISSUED = "LawPay card payments aren't switched on yet. Until then, record payments by hand on each quote.";

/** LawPay connected in one mode while Lectual charges in the other: card payments are paused. */
export function lawpayModeMismatch(connectionMode: string, lectualMode: string): string {
  return `Card payments are paused: your LawPay is in ${connectionMode} mode but Lectual is still in ${lectualMode} mode. Contact Lectual.`;
}

/** Integrations show a fixed sentence chosen by status; a stored error's own text is never drawn. */
export const SYNC_DID_NOT_FINISH = "The last sync didn't finish. Reconnect if it keeps happening.";
export const RECONNECT_TO_KEEP_SYNCING = "Reconnect to keep syncing.";
/** Written by the meetings importer when a pull is cut short; the one stored sentence that passes by exact match. */
export const MEETINGS_MORE_THAN_ONE_RUN =
  "More meetings than one run reads: the newest were imported, and the rest will follow on later runs where the provider allows.";
export function integrationErrorLine(status: string, lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  if (lastError === MEETINGS_MORE_THAN_ONE_RUN) return lastError;
  return status === "active" ? SYNC_DID_NOT_FINISH : RECONNECT_TO_KEEP_SYNCING;
}
/** One lead that Lawmatics import could not save (the database's own text stays in the logs). */
export const IMPORT_PERSON_NOT_SAVED = "This person couldn't be saved.";
