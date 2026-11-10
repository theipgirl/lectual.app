import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
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
/** What the Firm notes page says they are for. */
export const FIRM_NOTES_PURPOSE = "Your assistants use these to match your tone, prices and rules. Nothing here is sent to clients.";
/** The rail group holding Copilot, Assistants, Shortcuts and Firm notes (was "IP.OS"). */
export const AI_TOOLS_GROUP = "AI tools";
/** Drafts waiting for a person's OK (was "Queue"). */
export const APPROVALS_NAME = "Approvals";
/** The one page that replaces the Monday spreadsheet walk-through. */
export const REVIEW_NAME = "Weekly review";
/** The Weekly review's three views. */
export const REVIEW_BOARD_VIEW = "Board";
export const REVIEW_SHEET_VIEW = "Sheet";
/** The Weekly review view that deals one person's records as cue cards. */
export const REVIEW_CARDS_VIEW = "Cards";
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
export const FEATURES_SUBLINE_START = "Parts of Lectual that are switched on firm by firm. To add one,";
export const CONTACT_LECTUAL = "contact Lectual";
export const FEATURES_SUBLINE_END = "and we'll set it up with you.";

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
export const SIGN_IN_WAIT = "Please wait a little before asking for another link.";
export const SIGN_IN_INVITED_HELP = "Use the email your firm invited.";
export const SIGN_IN_NOT_INVITED = "Not invited yet? Ask your firm's owner to invite you.";
export const SIGN_IN_SPAM_HINT = "Can't find it? Check your spam or junk folder.";
export const SIGN_IN_CODE_LABEL = "Or enter the 6-digit code from the email";
export const SIGN_IN_CODE_BAD = "That code didn't work. Check the newest email, or get a new link.";
export const SIGN_IN_CODE_FORMAT = "Enter the 6 digits from the email.";
export const SIGN_IN_CONFIRM_TITLE = "Sign in to Lectual";
export const SIGN_IN_CONFIRM_BODY = "Press the button to finish signing in. This step keeps email security scanners from using up your link.";
export const SIGN_IN_CONFIRM_BUTTON = "Sign in";
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
/** Drafting needs the approvals queue; until Lectual switches it on, nothing is drafted. */
export const APPROVALS_NOT_READY = `${notReadyPlural("Approvals")} Nothing was drafted.`;
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

/** Sprint 32 shell names. */
export const MORE_NAME = "More";
export const SETUP_NAME = "Setup";
export const HELP_AND_TIPS = "Help and tips";
/** A setup step only Lectual can switch on: shown, never counted against the firm. */
export const LECTUAL_SETS_UP = "Lectual sets this up";

/** One name for the proposals area (was "Quotes & proposals" / "Client proposals" on its own pages). */
export const PROPOSALS_NAME = "Proposals";
export const PROPOSALS_SUBLINE = "Every proposal you've sent or started, newest first.";
/** Said once on the proposals list. */
export const FEE_SENTENCE = "Legal fee is due at signing. USPTO fees are paid at filing.";
/** A connect or run button that is disabled because the part isn't switched on. */
export const SWITCH_ON_WORDS = "Lectual needs to switch this on";
/** Where a Lawmatics token comes from. */
export const LAWMATICS_TOKEN_HELP = "In Lawmatics: Settings \u2192 API \u2192 create a token, then paste it here";

/** Sprint 34: the one sentence a read-only member sees on the Service library, instead of a wall of disabled fields. */
export const SERVICE_LIBRARY_READ_ONLY = `You can use these on quotes. ${ADMIN_TIER_PHRASE} can change the list.`;

/** Spec 9: the two kinds of proposal, as the New proposal "Type" choice names them. */
export const PROPOSAL_TYPE_TRADEMARK = "Trademark filing";
export const PROPOSAL_TYPE_GENERAL = "Contract or other matter (flat fee)";
/** Spec 9: the LOE step's sentence for a general (flat-fee) proposal. Never the trademark LOE. */
export const GENERAL_LOE_SENTENCE = "Draft the General LOE for this matter.";

/* ── Phase 1 owner view: views and shell (owned by the views/shell piece) ── */
/** The account menu's view group (Lectual staff acting inside a firm with the switch on; firm members never see it). */
export const VIEW_GROUP_NAME = "View";
export const OWNER_VIEW_NAME = "Owner view";
export const TECHNICIAN_VIEW_NAME = "Technician view";
export const TECHNICIAN_VIEW_SUB = "everything, as today";
/** The pill on the view row that is drawn right now. */
export const VIEW_CURRENT_PILL = "Showing";
export const PREVIEW_A_VIEW = "Preview a view";
export const VIEW_PREVIEW_NOTE = "A preview for this firm only. It changes what is drawn, not what can be opened.";
/** The owner phone bar's short name for the weekly review. */
export const REVIEW_SHORT_NAME = "Review";
export const SETTINGS_NAME = "Settings";
/** saveViewAction's fixed sentences. */
export const VIEW_NOT_SAVED = "We couldn't change your view. Try again.";
export const VIEW_NOT_SIGNED_IN = "You are not signed in.";
export const VIEW_PREVIEW_NOT_ALLOWED = "Only Lectual staff can preview a view, inside a firm that has views switched on.";

/* ── Phase 1 owner view: approval deck ── */
/** Yes is off while the card's editor is open: it would approve the saved text, not the edit. */
/** The deck when approval assignments couldn't be read: the usual approvers' rule applies. */
export const DECK_ROUTING_UNREAD = "Assignments couldn't be loaded. Showing the cards the usual approvers decide.";
export const DECK_EDITING_YES = "Approve from the editor, or close it first.";
export const DECK_TITLE = "Needs you";
export const dealHeader = (label: string) => `Today's deal · ${label}`;
export const nextDealHeader = (label: string) => `Next deal · ${label}`;
export const DECK_DEALT_NOW = "Dealt just now";
export const DECK_VIEW_CARDS = "Cards";
export const DECK_VIEW_LIST = "List";
export const DECK_VIEW_BOARD = "Board";
export const DECK_DEAL_NOW = "Deal them now";
export const deckLaterArrivals = (n: number, label: string) => `${n} more at ${label}`;
export const deckAllDecided = (label: string) => `All decided. Next deal ${label}.`;
export const DECK_NOTHING_NOW = "Nothing to decide right now.";
export const DECK_NOTHING_FOR_YOU = "There is nothing for you to decide here.";
/** Later cards with the day they come back: `when` is "today at 2:00 PM" / "tomorrow at 7:00 AM". */
export const deckLaterBackWhen = (n: number, when: string) => `${n} ${n === 1 ? "card is" : "cards are"} back ${when}.`;
export const deckLaterBack = (n: number, label: string) => `${n} ${n === 1 ? "card is" : "cards are"} back at ${label}.`;
/** The deck is empty for this person but the queue still holds items someone else decides. */
export const deckOthersWaiting = (n: number) => `${n} waiting for ${n === 1 ? "a colleague" : "colleagues"} to decide.`;
export const deckHandedCount = (n: number) => `${n} handed to ${n === 1 ? "a colleague" : "colleagues"}.`;
export const DECK_DRAFT_NONE = "Approved. No draft was made, so nothing is in a mailbox and nothing has been sent. Copy the text from the full approval page into an email, or connect a mailbox in Settings.";
export const DECK_ALL_LIST_HEADING = "Your approvals";
export const DECK_TAG_INTERNAL = "Internal";
export const deckTagYes = (minutes: number) => `Needs your yes · ${minutes} min`;
export const deckSource = (assistant: string) => `Lectual · ${assistant}`;
export const deckPosition = (position: number, total: number) => `${position} / ${total}`;
export const DECK_YES = "Yes";
export const DECK_MARK_READ = "Mark read";
export const DECK_REJECT = "Reject";
export const DECK_LATER = "Later";
export const DECK_EDIT = "Edit";
export const DECK_HAND_OFF = "Hand off";
export const DECK_HAND_TO = "Hand to";
export const DECK_SEND_BACK = "Send back";
export const DECK_OPEN_TO_REVIEW = "Open to review";
export const DECK_BACK = "Previous card";
export const DECK_SKIP = "Next card";
export const DECK_REJECT_NOTE_LABEL = "Why are you rejecting it?";
export const DECK_REJECT_NOTE_NEEDED = "Add a short note first. It goes back to the assistant that drafted it.";
export const DECK_HAND_NOTE_LABEL = "Note for them (optional)";
export const deckHolding = (seconds: number) => `Approving in ${seconds}…`;
export const DECK_UNDO = "Undo";
export const DECK_HOLD_NOTE = "Nothing happens until the countdown ends. Once approved, it can't be un-approved here.";
export const DECK_DRAFT_IN_OUTLOOK = "Draft is in Outlook. Nothing is sent until someone presses Send.";
export const DECK_DRAFT_IN_GMAIL = "Draft is in Gmail. Nothing is sent until someone presses Send.";
export const DECK_OPEN_DRAFT = "Open the draft";
export const DECK_SEND_NOW = "Send from Outlook now";
export const deckSentAt = (time: string) => `Sent from Outlook by you at ${time}.`;
export const DECK_SEND_OFF = "Sending from here isn't switched on for you. Open the draft in Outlook and press Send there.";
export const DECK_SEND_RECONNECT = "To send from here, reconnect your Outlook in Settings and allow sending. Until then, press Send in Outlook.";
export const DECK_MARKED_READ = "Marked read.";
export const DECK_REJECTED = "Rejected. The note goes back to the assistant. Nothing was sent.";
export const DECK_HANDED_OFF = "Handed off. It's on their cards now.";
export const DECK_LATER_DONE = "Put off until the next deal.";
export const DECK_SENT_BACK = "Sent back.";
export const handedBy = (name: string) => `Handed to you by ${name}`;
export const DECK_HANDED_NO_YES = "You can edit this and send it back. The yes stays with an approver.";
export const DECK_CLOSER_LOOK = "This one needs a closer look before it can be approved.";
export const DECK_COL_NEEDS_YES = "Needs your yes";
export const DECK_COL_HANDED_OFF = "Handed off";
export const DECK_COL_LATER = "Later";
export const DECK_COL_DECIDED = "Decided today";
export const DECK_DECIDED_UNREAD = "Decided today couldn't be loaded. Refresh to try again.";
export const DECK_EVENTS_UNREAD = "Hand-offs and Later couldn't be loaded, so every card is shown.";
export const DECK_NOTHING_HERE = "Nothing here.";
export const DECK_NOT_YOURS = "This card isn't on your deck any more. Refresh to see what's left.";
export const DECK_FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";
export const DECK_PICK_PERSON = "Choose who to hand it to.";
export const DECK_BAD_PERSON = "That person can't take approvals. Choose someone else on your team.";
/* Deck page, card, side list, list and board (owner view fidelity rebuild). */
export const DECK_PAGE_TITLE = "Your deal";
export const DECK_PAGE_SUB = "Drafts wait here until you decide. Approving a client email places a draft in Outlook; a person sends it.";
export const DECK_DEAL_NEW = "Deal new cards";
export const deckLeft = (n: number, minutes: number) => `${n} left · about ${minutes} min`;
export const DECK_META_ALL_DECIDED = "All decided";
export const DECK_META_CANT_SHOW = "Can't show";
export const DECK_META_NOT_CONNECTED = "Not connected";
export const DECK_ARRIVED_NOTE = "They arrived after this deal opened.";
export const deckArrivedTitle = (label: string) => `Arrived after ${label}`;
export const deckArrivedCount = (n: number, next: string) => `${n} · in the ${next} deal`;
export const deckArrivedBody = (next: string) => `Counted, not dealt. They open at ${next}, or now with Deal them now.`;
export const DECK_SIDE_TITLE = "All your approvals";
export const deckSideCounts = (waiting: string, decided: string) => `${waiting} waiting · ${decided} decided`;
export const DECK_SIDE_NOTHING_LEFT = "Nothing left in this deal.";
export const DECK_SIDE_NOTHING_DECIDED = "Nothing decided yet today.";
export const DECK_SIDE_CANT = "Can't show this list right now. Nothing is shown as decided.";
export const DECK_SIDE_CANT_DECIDED = "Can't show this list right now.";
export const DECK_CHIP_NOW = "Now";
export const DECK_CHIP_WAITING = "Waiting";
export const DECK_CHIP_SKIPPED = "Skipped";
export const DECK_CHIP_APPROVED = "Approved";
export const DECK_CHIP_REJECTED = "Rejected";
export const DECK_SUB_REJECT = "needs a note";
export const DECK_SUB_LATER = "next deal";
export const DECK_SUB_EDIT = "opens the editor";
export const DECK_SUB_HAND = "to a colleague";
export const DECK_SUB_SEND_BACK = "to who handed it";
export const DECK_SUB_YES = "5-second Undo";
export const DECK_SUB_OPEN = "opens the item";
export const DECK_SUB_READ = "nothing is sent";
export const deckArrowsHint = (position: number, total: number) => `The arrows beside ${position} / ${total} move through the deal. Nothing is stored.`;
export const DECK_FIRST_STEP = "First step:";
export const DECK_REVIEW_HEAD = "Open to review.";
export const DECK_REJECT_EYEBROW = "Reject this draft";
export const DECK_REJECT_HELP = "The note is kept with the item. Nothing is sent.";
export const DECK_CANCEL = "Cancel";
export const DECK_REJECT_DRAFT = "Reject draft";
export const DECK_HAND_EYEBROW = "Hand off";
export const DECK_HAND_WHY = "Anything client-facing comes back to an approver for the yes.";
export const deckApprovedLine = (title: string) => `Approved · ${title}`;
export const DECK_CHOICE_DRAFT_OUTLOOK = "Put the draft in Outlook";
export const DECK_CHOICE_DRAFT_GMAIL = "Put the draft in Gmail";
export const DECK_CHOICE_DEFAULT = "The default";
export const DECK_CHOICE_YOU_PRESS = "You press it yourself";
export const DECK_COULDNT_LOAD = "Couldn't load";
export const DECK_TRY_AGAIN = "Try again";
export const DECK_NOT_CONNECTED = "Not connected";
export const deckClean = (approved: number, rejected: number, waiting: number) => `${approved} approved · ${rejected} rejected · ${waiting} waiting`;
export const DECK_LIST_FOOT = "Opening an item shows today's item page, where you can edit, approve or reject it.";
export const DECK_BOARD_SUB = "Every approval by where it stands. Drag is not offered: each move is a button on the card.";
export const deckListSub = (waiting: number, inDeal: number, arrived: number, label: string) =>
  `Everything waiting, not only this deal. ${waiting} waiting on you · ${inDeal} in this deal${arrived > 0 ? ` · ${arrived} arrived after ${label}` : ""}.`;
export const DECK_ST_SKIPPED_WAITING = "Skipped · waiting";
export const DECK_ST_WAITING = "Waiting";
export const DECK_ST_NEXT_DEAL = "Next deal";
export const DECK_BADGE_YES = "Yes?";
export const DECK_BADGE_REVIEW = "Review";
export const DECK_BADGE_INTERNAL = "Internal";

/* ── Phase 1 owner view: owner Today ── */
export const OWNER_CARDS_HEADING = "Your cards";
export const OWNER_CARDS_START = "Start";
export const OWNER_CARDS_NONE_STATUS = "No approval cards to deal right now.";
export const OWNER_CARDS_UNREACHABLE = "Couldn't load your cards.";
export const OWNER_CARDS_NOT_CONNECTED = "No approval queue is connected for your firm yet.";
export function ownerCardsCount(count: number, minutes: number): string {
  return `${count} ${count === 1 ? "card needs" : "cards need"} you \u00b7 about ${minutes} min`;
}
export function ownerCardsNextDeal(count: number, label: string, later: number): string {
  const more = later > 0 ? ` ${later} more at ${label}.` : "";
  return count > 0 ? `Next deal ${label}.${more}` : `All decided. Next deal ${label}.${more}`;
}
export const OWNER_DEADLINES_HEADING = "Deadlines, next 14 days";
export const OWNER_DEADLINES_NONE = "Nothing due in the next 14 days.";
export const OWNER_DEADLINES_FAILED = "Couldn't load deadlines.";
export const OWNER_CALENDAR_LINK = "Calendar \u2192";
export const OWNER_PROPOSALS_HEADING = "Proposals out";
export const OWNER_PROPOSALS_NONE = "No proposals are out right now.";
export const OWNER_PROPOSALS_FAILED = "Couldn't load proposals.";
export const OWNER_PROPOSALS_LINK = "Proposals \u2192";
export const OWNER_WEEK_HEADING = "This week";
export const OWNER_WEEK_CONSULTS_FAILED = "Consults couldn't be read, so only deadlines are marked.";
export const OWNER_WEEK_DEADLINES_FAILED = "Deadlines couldn't be read, so only consults are marked.";
export const OWNER_WEEK_BOTH_FAILED = "Couldn't load this week.";
export const OWNER_COPILOT_HEADING = "Ask Copilot";
export const OWNER_COPILOT_LABEL = "Ask a question about your matters, leads or deadlines";
export const OWNER_COPILOT_PLACEHOLDER = "For example: which matters are waiting on us?";
export const OWNER_COPILOT_BUTTON = "Ask";
export const OWNER_COPILOT_NOTE = "Answers come from your firm's own records. Nothing is sent.";
export const OWNER_COPILOT_SUB = "Answers from your firm\u2019s own records: matters, leads, deadlines and activity.";
export const OWNER_COPILOT_SUB_SHORT = "Answers from your firm\u2019s own records.";
export const OWNER_COPILOT_ASK_PLACEHOLDER = "Ask about your matters and leads";
export const OWNER_COPILOT_CHIPS = ["What\u2019s due this week?", "Which proposals haven\u2019t been opened?", "Who haven\u2019t we heard from in 14 days?"] as const;
export const OWNER_COPILOT_PHONE_PLACEHOLDER = "What\u2019s due this week?";
export const OWNER_COPILOT_PHONE_CHIPS = [
  { label: "Proposals not opened", question: "Which proposals haven\u2019t been opened?" },
  { label: "Quiet 14 days", question: "Who haven\u2019t we heard from in 14 days?" },
] as const;
export function ownerSeeAll(total: number): string {
  return `See all ${total}`;
}
export const OWNER_CONSULTS_HEADING = "Today\u2019s consults";
export const OWNER_CONSULTS_NONE_TODAY = "No consults today.";
export const OWNER_CONSULTS_FAILED = "Couldn't load consults.";
export const OWNER_CONSULT_LEAD_LINK = "Lead";
export const OWNER_CONSULT_JOIN_LINK = "Join link";
/** The join link's words on owner Today's consult row, named for the meeting service as the board does ("Zoom link"). */
export function ownerConsultJoinLink(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return OWNER_CONSULT_JOIN_LINK;
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us") || host === "zoom.com" || host.endsWith(".zoom.com")) return "Zoom link";
  if (host === "teams.microsoft.com" || host === "teams.live.com") return "Teams link";
  return OWNER_CONSULT_JOIN_LINK;
}
export const OWNER_WEEK_KEY_CONSULT = "consult";
export const OWNER_WEEK_KEY_DEADLINE = "deadline";
export const OWNER_WEEK_OPEN_CALENDAR = "Open Calendar";
export const OWNER_WEEK_NOT_LOADED = "Not loaded";
export const OWNER_WEEK_LAST_DAY = "Last day";
export const OWNER_WEEK_DUE = "Due";
export const OWNER_PROPOSALS_SORT_NOTE = "soonest last day first";
export const OWNER_PROPOSAL_LINK_LIVE = "Link live";
export const OWNER_CARDS_FOR_YOU = "for you";
export function ownerCardsWord(count: number): string {
  return count === 1 ? "card" : "cards";
}
export function ownerCardsAbout(minutes: number): string {
  return `about ${minutes} min`;
}
export function ownerDealLine(openedLabel: string | null, nextLabel: string, later: number): string {
  const opened = openedLabel ? `Deal opened ${openedLabel}. ` : "";
  const more = later > 0 ? ` ${later} more at ${nextLabel}.` : "";
  return `${opened}Next deal ${nextLabel}.${more}`;
}
export function ownerProposalOpens(opens: number | "unavailable" | undefined): string | null {
  if (opens === undefined) return null;
  if (opens === "unavailable") return "Couldn't load opens";
  if (opens === 0) return "not opened yet";
  return `opened ${opens} ${opens === 1 ? "time" : "times"}`;
}
export function ownerDayChip(days: number): string {
  if (days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}


/* ── Phase 1 owner view: weekly review ── */
/** The weekly review's firm-wide "since" display filter chip. */
export const REVIEW_SINCE_LABEL = "Since Feb 2026";
/** Shown instead of the since chips when a read the filter relies on failed: nothing older is hidden. */
export const REVIEW_SINCE_SUSPENDED = "Showing all: some details couldn't load, so older rows aren't hidden";
export const REVIEW_SHOW_ALL = "Show all";
export const REVIEW_SHOWING_ALL = "Showing all";
export const reviewOlderHidden = (n: number) => `${n} older hidden`;
export const reviewIntro = (shown: number) => `Every open matter and every lead past first contact. ${shown} shown.`;
/** The strip that is about the signed-in approver. */
export const WAITING_ON_YOU = "Waiting on you";
export const NOTHING_WAITING_ON_YOU = "Nothing is waiting on you.";
export const WAITING_ON_YOU_PARTIAL = "Approvals couldn't load, so only next steps assigned to you are listed.";
export const deckWaiting = (age: string) => `Waiting ${age}`;
export const deckWaitingTo = (name: string, age: string) => `Waiting to ${name} · ${age}`;
export const deckWaitingBack = (label: string) => `Waiting back at ${label}`;
export const deckDecidedAt = (what: "approved" | "rejected", time: string, noteKept: boolean) => `${what} ${time}${noteKept ? " · note kept" : ""}`;
export const DECK_FOR = "for";

/* ── Owner view: the weekly review's editable Sheet ── */
export const SHEET_YOU_TYPE = "You type these";
export const SHEET_YOU_TYPE_BODY = "Status (moves the stage), Next step (text and due date), Whose court (a person), Source. Each change saves on its own and is logged on the record.";
export const SHEET_WORKED_OUT = "Lectual works these out";
export const SHEET_WORKED_OUT_BODY = "Waiting on and Last contact come from next steps, mail and calls. They can't be edited here; log what happened with + Note instead.";
export const SHEET_LEGEND_LABEL = "Which columns you can edit";
export const SHEET_KEYS_EDIT = "or click to edit";
export const SHEET_KEYS_NEXT = "next cell";
export const SHEET_KEYS_CANCEL = "cancel · Drag a column edge to resize";
export const SHEET_MOVE_TO_STAGE = "Move to stage";
export const sheetMoveLogged = (firstName: string) => `The move is logged on ${firstName}'s timeline.`;
export const SHEET_FIND_PERSON = "Find a person";
export const SHEET_NO_ONE_FOUND = "No one matches.";
export const SHEET_NEXT_STEP = "Next step";
export const SHEET_DUE = "Due";
export const SHEET_ENTER_ESC = "Enter to save · Esc to cancel";
export const SHEET_NOTE_BUTTON = "+ Note";
export const sheetNoteFor = (client: string) => `Add a note for ${client}`;
export const SHEET_WHAT_HAPPENED = "What happened?";
export const sheetNoteHint = (firstName: string) => `Goes on ${firstName}'s timeline as a note and counts as last contact.`;
export const SHEET_ADD_NOTE = "Add note";
export const SHEET_CANCEL = "Cancel";
export const SHEET_NO_SOURCE = "No source";
export const SHEET_SOURCE_LABEL = "Source";
export const SHEET_OVERDUE = "(overdue)";
export const sheetSaved = (client: string, field: string) => `Saved · ${client}, ${field}`;
export const sheetSaving = (client: string, field: string) => `Saving · ${client}, ${field}`;
/** After a refused save: the action's own fixed sentence, then this. */
export const SHEET_PUT_BACK = "The earlier value is back.";
export const SHEET_NOTE_NOT_SAVED = "The note wasn't saved.";
export const SHEET_TRY_AFTER_REFRESH = "Couldn't save this yet. Refresh the page and try again.";
export const SHEET_ENTER_TITLE = "Enter what happens next.";
export const SHEET_WRITE_NOTE = "Write what happened.";
export const SHEET_STAGES_UNREADABLE = "The stage list couldn't load, so Status can't be changed here right now. Refresh to try again.";
export const sheetResizeColumn = (name: string) => `Resize ${name} column`;
export const SHEET_RESIZE_ROW = "Resize row";
export const SHEET_EMPTY_SECTION = "Nothing here for this view.";
export const SHEET_SAVE_FAILED = "Couldn't save this change.";
