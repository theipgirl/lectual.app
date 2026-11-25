import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import {  } from "@/lib/ui/words";
// The glossary: ONE name per thing, as a firm sees it. Every firm-facing string that
// names one of these things imports it from here (tests/ui/words.test.ts and
// tests/ui/no-build-words.test.ts hold that line). Pure: no imports from components.
// URLs, slugs, data-tour tokens, anchors, DB values and agent ids keep their old names;
// only the words a person reads change.

/** The names of the views every pick-one switch uses (Board first; the table / sheet view is always "List"). */
export const VIEW_BOARD = "Board";
export const VIEW_LIST = "List";
export const VIEW_CARDS = "Cards";

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
/** Section and page names said once (item 22): the mailbox section, the proposal settings page, the forms list. */
export const MAIL_NAME = "Mail";
export const PROPOSAL_SETTINGS_NAME = "Proposal settings";
export const FORMS_NAME = "Forms";
/** The Weekly review's three views. */
export const REVIEW_BOARD_VIEW = VIEW_BOARD;
export const REVIEW_SHEET_VIEW = VIEW_LIST;
/** The Weekly review view that deals one person's records as cue cards. */
export const REVIEW_CARDS_VIEW = VIEW_CARDS;
/** The section where new work arrives: the page, tab title, rail group, phone bar and More sheet (Nov 12: was "Leads"). */
export const INTAKE_NAME = "Intake";
/** The rail's list row under Intake: the people who have asked about work. */
export const INTAKE_LEADS_ROW = "Leads";
/** Matters whose next step is the firm's (was "Our move"). */
export const OUR_TURN = "Our turn";
/** Column and field words shared by every list (Owner, Last contact, Next step). */
export const OWNER_COLUMN = "Owner";
export const LAST_CONTACT = "Last contact";
export function lastContactAgo(days: number): string {
  return days <= 0 ? "Last contact today" : `Last contact ${days} ${days === 1 ? "day" : "days"} ago`;
}
export const NEXT_STEP = "Next step";
export const NEXT_STEPS = "Next steps";
export const ADD_NEXT_STEP = "Add a next step";
/** Buttons and short states, said once. */
export const ADD_A_LEAD = "Add a lead";
export const addLeadFor = (name: string) => `Add a lead for ${name}`;
export const ADD_TO_TIMELINE = "Add to timeline";
export const DELETE = "Delete";
export const SAVING = "Saving…";
export const LOADING = "Loading…";
export const SAVED = "Saved.";
export const CANCEL = "Cancel";
export const yesVerb = (verb: string) => `Yes, ${verb.trim().toLowerCase()}`;
/** Blank cell, no owner, a person the directory doesn't know. */
export const BLANK = "—";
export const UNASSIGNED = "Unassigned";
export const TEAMMATE = "Teammate";
export const SHOW_MORE = "Show more";
/** A search box's placeholder. */
export const searchPlaceholder = (what: string) => `Search ${what}`;
/** "Showing 40 of 112" (re-exported by lib/ui/format.ts). */
export const showingOf = (shown: number, total: number): string => "Showing " + shown + " of " + total;
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
export const cantShowTitle = (what: string) => `Can't show ${what} right now`;
export const REFRESH_TO_TRY_AGAIN = "Refresh to try again.";
export const REFRESH = "Refresh";
/** An empty list that was READ successfully: "No proposals yet. Start one from a lead." */
export const noneYet = (what: string, how?: string) => `No ${what} yet.${how ? ` ${how}` : ""}`;
export const columnEmpty = (noun: string) => `No ${noun} here yet.`;
export const OPTIONAL = "(optional)";
export const TEAM_NAME = "Team";
export const APPROVAL_SETTINGS_NAME = "Approval settings";
export const LAWMATICS_NAME = "Lawmatics";
export const MEETINGS_INTEGRATION_NAME = "Meetings integration";
export const EMAIL_TEMPLATES_NAME = "Email templates";
export const NEW_LETTER_NAMES = { loe: "New engagement letter", opinion: "New opinion letter", clearance: "New trademark clearance" } as const;
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
export const PIPELINE_VIEW_ONLY = "This is a view-only overview. To move a lead, open it in Intake.";
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
/** Proposals list segments whose names depend on the paid rule: a paid proposal leaves the default list and is listed under Paid. */
export const PROPOSALS_EVERYTHING_SEGMENT = "Current";
export const PROPOSALS_PAID_SEGMENT = "Paid";
/** Footer of the default list when paid proposals are kept out of it: "6 proposals · 2 paid, listed under Paid". */
export function proposalsPaidAsideNote(hidden: number): string {
  return `${hidden} paid, listed under ${PROPOSALS_PAID_SEGMENT}`;
}
/** The Paid segment while the paid read failed: never an empty list, never a count. */
export const PROPOSALS_PAID_UNREADABLE = "Paid status couldn't be read, so paid proposals can't be listed right now. Refresh to try again.";
/** Every proposal is paid, so the default list is empty. */
export const PROPOSALS_ALL_PAID = "Every proposal is paid.";
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
export const DECK_VIEW_CARDS = VIEW_CARDS;
export const DECK_VIEW_LIST = VIEW_LIST;
export const DECK_VIEW_BOARD = VIEW_BOARD;
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
/** Done: a card handled without approving. The ONE marker note a Done resolve carries; every surface reads the outcome through it. */
export const DONE_NOTE = "Done: handled without approving";
export const DECK_DONE = "Done";
export const DECK_SUB_DONE = "no approval";
export const DECK_DONE_MESSAGE = "Done. Marked as handled. Nothing was approved or sent.";
export const DECK_CHIP_DONE = "Done";
/** A typed Reject note may not be the Done marker: it would read as Done everywhere. */
export const REJECT_NOTE_IS_DONE_MARKER = "Write your own reason for rejecting. That wording is kept for Done.";
/** The Done button's tooltip while the editor is open. */
export const DECK_EDITING_DONE = "Close the editor first, then mark it done.";
export const deckDoneHolding = (seconds: number) => `Marking done in ${seconds}…`;
export const DECK_DONE_HOLD_NOTE = "Nothing happens until the countdown ends. Done approves nothing and sends nothing.";
export const DONE_OUTCOME_TEXT = "Done. Marked as handled without approving. Nothing was sent.";
export const handedBy = (name: string) => `Handed to you by ${name}`;
export const DECK_HANDED_NO_YES = "You can edit this and send it back. The yes stays with an approver.";
export const DECK_CLOSER_LOOK = "This one needs a closer look before it can be approved.";
export const DECK_COL_NEEDS_YES = "Needs your yes";
export const DECK_COL_HANDED_OFF = "Handed off";
export const DECK_COL_LATER = "Later";
export const DECK_COL_DECIDED = "Decided today";
export const DECK_DECIDED_UNREAD = "Decided today couldn't be loaded. Refresh to try again.";
export const DECK_EVENTS_UNREAD = "Hand-offs and Later couldn't be loaded, so every card is shown.";
/** An empty Approvals board column or list: the shared empty-state sentences ("No approvals here yet." / "No approvals yet."). */
export const DECK_BOARD_EMPTY = columnEmpty("approvals");
export const DECK_LIST_EMPTY = noneYet("approvals");
/** Lectual staff viewing a firm have no membership, so a hand-off or send-back would be dropped by the fold: refuse it plainly. */
export const DECK_PREVIEW_ONLY = "Preview only: hand-offs aren't saved while you're viewing as the firm.";
export const DECK_NOT_YOURS = "This card isn't on your deck any more. Refresh to see what's left.";
export const DECK_FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";
export const DECK_PICK_PERSON = "Choose who to hand it to.";
export const DECK_BAD_PERSON = "That person can't take approvals. Choose someone else on your team.";
/* Deck page, card, side list, list and board (owner view fidelity rebuild). */
export const DECK_PAGE_TITLE = APPROVALS_NAME;
/** Shared by the deck intro and the welcome deal's card 2. */
export const DECK_APPROVING_NEVER_SENDS = "Approving never sends.";
export const DECK_PAGE_SUB = `${DECK_APPROVING_NEVER_SENDS} A client email becomes a draft; a person presses Send.`;
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
export const DECK_CANCEL = CANCEL;
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
export const deckClean = (approved: number, rejected: number, waiting: number, done = 0) =>
  `${approved} approved · ${rejected} rejected${done > 0 ? ` · ${done} done` : ""} · ${waiting} waiting`;
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
/* ── Phase 2 item 4: deal-ready nudge (Today tile, Approvals rail row and phone item) ── */
export function dealReadyLine(label: string, count: number): string {
  return `Your ${label} deal is ready · ${count} ${count === 1 ? "card" : "cards"}`;
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
/** Today tile sub-line while a deal is ready (the dot is drawn in front of it); otherwise ownerDealLine. */
export function ownerDealReadyLine(readyLabel: string, nextLabel: string, later: number): string {
  const more = later > 0 ? ` ${later} more at ${nextLabel}.` : "";
  return `Your ${readyLabel} deal is ready. Next deal ${nextLabel}.${more}`;
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
/** The Weekly review sub-line's counts: "5 open", or "5 open · 2 registered" when registered marks with no Section 8 / 9 deadline are shown. */
export const reviewOpenCounts = (open: number, registered: number) => (registered > 0 ? `${open} open · ${registered} registered` : `${open} open`);
export const reviewIntro = (shown: number) => `Every open matter and every lead past first contact. ${shown} shown.`;
/** The strip that is about the signed-in approver. */
export const WAITING_ON_YOU = "Waiting on you";
export const NOTHING_WAITING_ON_YOU = "Nothing is waiting on you.";
export const WAITING_ON_YOU_PARTIAL = "Approvals couldn't load, so only next steps assigned to you are listed.";
export const deckWaiting = (age: string) => `Waiting ${age}`;
export const deckWaitingTo = (name: string, age: string) => `Waiting to ${name} · ${age}`;
export const deckWaitingBack = (label: string) => `Waiting back at ${label}`;
export const deckDecidedAt = (what: "approved" | "rejected" | "done", time: string, noteKept: boolean) => `${what} ${time}${noteKept ? " · note kept" : ""}`;
export const DECK_FOR = "for";

/* ── Owner view: the weekly review's editable Sheet ── */
export const SHEET_YOU_TYPE = "You type these";
export const SHEET_YOU_TYPE_BODY = `Status (moves the stage), Next step (text and due date), ${OWNER_COLUMN} (a person), Source, Notes (a new note on the timeline). Each change saves on its own and is logged on the record.`;
export const SHEET_WORKED_OUT = "Lectual works these out";
export const SHEET_WORKED_OUT_BODY = "Waiting on and Last contact come from next steps, mail and calls. Serial No., Start Date, Practice Area and Office Action Due Date come from the record itself. None of these can be edited here; type what happened in Notes instead.";
/** Added to the legend for the viewer who may see fees (the owner) and nobody else. */
export const SHEET_WORKED_OUT_FEES = "The fee columns come from the accepted proposal, else from the spreadsheet import.";
export const SHEET_LEGEND_LABEL = "Which columns you can edit";
export const SHEET_KEYS_EDIT = "or click to edit";
export const SHEET_KEYS_NEXT = "next cell";
export const SHEET_KEYS_CANCEL = "cancel · Drag a column edge to resize";
export const SHEET_MOVE_TO_STAGE = "Move to stage";
export const sheetMoveLogged = (firstName: string) => `The move is logged on ${firstName}'s timeline.`;
export const SHEET_FIND_PERSON = "Find a person";
export const SHEET_NO_ONE_FOUND = "No one matches.";
export const SHEET_NEXT_STEP = NEXT_STEP;
export const SHEET_DUE = "Due";
export const SHEET_ENTER_ESC = "Enter to save · Esc to cancel";
export const SHEET_CANCEL = CANCEL;
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
export const SHEET_STAGES_UNREADABLE = "The stage list couldn't load, so Status can't be changed here right now. Refresh to try again.";
export const sheetResizeColumn = (name: string) => `Resize ${name} column`;
export const SHEET_RESIZE_ROW = "Resize row";
export const SHEET_EMPTY_SECTION = noneYet("records in this view");
export const SHEET_SAVE_FAILED = "Couldn't save this change.";
/** The Sheet's Notes column: the newest plain note, typed in place (Enter or leaving the cell saves, Esc cancels). */
export const SHEET_NOTES_COLUMN = "Notes";
export const SHEET_NOTE_CANT_LOAD = DECK_COULDNT_LOAD;
export const SHEET_NOTE_ADD = "Add a note";
export const SHEET_NOTE_SAVING = "Saving…";
export const SHEET_NOTE_SAVED = "Saved";
export const SHEET_NOTE_SAVE_FAILED = "Couldn't save";
export const SHEET_NOTE_KEYS = "Enter to save · Shift+Enter for a new line · Esc to cancel";
export const SHEET_NOTE_NOT_SAVED_YET = "Not saved yet. Press Enter to save.";
export const sheetNoteCellLabel = (client: string) => `Note for ${client}`;

/* Needs review (Today, both views): old hand-entered dates nobody confirmed. */
export const NEEDS_REVIEW_HEADING = "Needs review";
export const NEEDS_REVIEW_FAILED = "Couldn't load the dates to review.";
export function needsReviewExplain(days: number): string {
  return `Entered by hand, never confirmed, and more than ${days} days past due. Confirm, close or correct each on its matter.`;
}
export function needsReviewPastDue(days: number): string {
  return days === 1 ? "1 day past due" : `${days} days past due`;
}
export function needsReviewCut(shown: number, total: number): string {
  return `Showing the oldest ${shown} of ${total}.`;
}

/* Engagement letter (Settings -> Proposals -> Engagement letter). The firm's own letter, shown and recorded by the software. */
export const ENGAGEMENT_LETTER_NAME = "Engagement letter";
export const ENGAGEMENT_LETTER_SUB =
  "The letter a client reads and signs on their proposal. It is your firm's own text: Lectual shows it and records the signature, and writes none of it.";
export const LETTER_KIND_WORDS = { trademark: "Trademark letter", general: "Flat-fee letter" } as const;
export const LETTER_STATUS_WORDS = { draft: "Draft", approved: "Approved", retired: "Retired" } as const;
export const LETTER_START_DRAFT = "Start a draft";
export const LETTER_START_FROM_VERSION = "Start a new draft from this version";
export const LETTER_SAVE_DRAFT = "Save draft";
export const LETTER_APPROVE = "Approve";
export const LETTER_PREVIEW_HEADING = "Preview with sample values";
export const LETTER_PREVIEW_NOTE = "Made-up client details, so you can see a whole letter. The preview shows the saved draft: save first to refresh it.";
export const LETTER_EMPTY_STATE = "No letter yet. Start a draft, and it can be approved once the text is final.";
export const LETTER_NOT_YET_DRAFTED = "Nobody has written this letter yet.";
export const LETTER_LOAD_FAILED = "The letters couldn't be loaded. Refresh to try again.";
export const LETTER_READ_ONLY_NOTE = "You can read the letters. An owner, admin or senior admin writes them.";
export const LETTER_FIELDS_HEADING = "Merge fields you can use";
export const LETTER_FIELDS_NOTE = "Write a field in double braces, for example {{client_name}}. Anything else in braces is refused.";
export const LETTER_APPROVAL_NOTE = "Approving makes this the letter new proposals attach. An approved version can't be edited; a change is a new draft.";
export const LETTER_NO_APPROVERS = `No one is named yet. Name approvers under ${PROPOSAL_SETTINGS_NAME}, or no letter can be approved.`;
export function letterApproversLine(names: string): string {
  return `Can approve: ${names}.`;
}
export const LETTER_APPROVERS_UNREADABLE = "Who can approve couldn't be loaded, so Approve is hidden. Refresh to try again.";
export const LETTER_FIX_BEFORE_APPROVING = "Fix the problems above before approving.";
export const LETTER_SETTINGS_LINK = "Engagement letter";
export const LETTER_SETTINGS_LINK_NOTE = "The letter a client signs on their proposal, with its versions and who approves them.";

/* Engagement letter section of the proposal editor (Sprint 6). */
export const LETTER_SECTION_HEADING = "Engagement letter";
export const LETTER_SECTION_HINT = "The letter your client reads and signs on the proposal page before paying. It is your firm's own text.";
export const LETTER_SWITCH_LABEL = "Include the engagement letter";
export const LETTER_SWITCH_ON_NOTE = "The client reads the letter, signs it, then pays. Saving this proposal copies your firm's current approved letter onto it.";
export const LETTER_SWITCH_OFF_NOTE = "Off: the client accepts and pays with no letter to sign.";
export const LETTER_SETUP_LINE = "Your firm has no approved engagement letter for this kind of proposal yet. Write and approve one, then turn it on here.";
export const LETTER_SETUP_LINK = "Set up the engagement letter";
export const LETTER_SECTION_UNREADABLE = "Your firm's engagement letter couldn't be loaded, so the switch is hidden. Refresh to try again. Nothing was changed.";
export const LETTER_ABSENT_NOTE = "This proposal has no engagement letter.";
export const LETTER_PREVIEW_CONTROL = "Preview the letter";
export const LETTER_PREVIEW_PLACEHOLDER_NOTE = "Fields the client fills in or that are set when they sign show in [brackets].";
export const LETTER_READ_ONLY_SECTION_NOTE = "Your role can read this but not change it.";
export const letterAttachedLabel = (version: number): string => `Version ${version}, approved`;
export const LETTER_NEWER_VERSION_NOTE = "Your firm has approved a newer version. Save this proposal to use it.";
export const LETTER_LIVE_COPY_NOTE = "This is the copy the client reads and signs.";

/* Signed letter card on the staff proposal page (Sprint 6). */
export const SIGNED_CARD_HEADING = "Engagement letter";
export const SIGNED_CARD_UNAVAILABLE = "The signature record couldn't be loaded. Refresh to try again.";
export const SIGNED_DOWNLOAD = "Download the signed letter (PDF)";
export const SIGNED_DOWNLOADING = "Preparing…";
export const SIGNED_FILING_HEADING = "Filed in Lawmatics";
export const SIGNED_FILING_NOT_YET = "Not filed yet.";
export const SIGNED_FILING_OK = "Filed in the matter's Engagement folder.";
export const MAILING_ADDRESS_HEADING = "Mailing address (from the signed engagement letter)";
export const MAILING_ADDRESS_UNAVAILABLE = "The mailing address from the signed letter couldn't be loaded. Refresh to try again.";
export const SIGNED_ADDRESS_HEADING = "Mailing address in Lawmatics";
export const SIGNED_ADDRESS_NOT_YET = "Not added yet.";
export const SIGNED_TRY_AGAIN = "Try again";
export const SIGNED_FINGERPRINT_LABEL = "Fingerprint (sha256)";
export const SIGNED_DOWNLOAD_NOT_ALLOWED = "Your role can't download the signed letter.";
/** For a role that may not read the signature record: who signed and when, from the accepted proposal itself. */
export function signedSummaryLine(name: string, when: string): string {
  return when ? `Signed by ${name} on ${when}` : `Signed by ${name}`;
}
/**
 * The check an assistant's or Copilot's draft carries when the firm's engagement letter couldn't be read as the draft was made
 * (drawn in the editor's "Ready to send?" list, linked to the Engagement letter section). The same opening words a person gets
 * from the from-scratch door, which creates nothing in that case.
 */
export const LETTER_NOT_ATTACHED_CHECK =
  "Couldn't read your engagement letter when this draft was made, so it isn't attached yet. Open the proposal and save it: the letter is attached if your firm has one.";
/**
 * The blocking "Fix" the editor shows while that check is unresolved (`validateContent` with `forApproval`), and what the link
 * buttons answer. It never says "turn it on": the switch starts on, and where the firm has no letter there is no switch and a
 * Save clears the item.
 */
export const LETTER_PENDING_FIX =
  "The engagement letter isn't attached yet. Save this proposal: the letter is attached if your firm has one, or turn it off in the Engagement letter section to send without it.";
/** Under the switch while it is on by default for such a draft. */
export const LETTER_PENDING_SWITCH_NOTE = "Not attached yet. Save this proposal to attach it, or turn it off to send without a letter.";
/** Shown on the staff card when the signed PDF is produced from the stored signed text rather than rebuilt. */
export const SIGNED_FROM_STORED_TEXT =
  "This copy is produced from the stored signed text: the exact words that were signed, as plain paragraphs. Its fingerprint matches that text.";
/* Approval deck: Decided and Handed off lists, and the side column's three sections (Phase 2 item 1). */
export const DECK_LISTS_BACK = "← Back to today's deal";
export const DECK_LISTS_NAV = "Approval lists";
export const deckListChip = (label: string, count: string) => `${label} · ${count}`;
export const DECK_LIST_HANDED_CANT = "Hand-offs couldn't be loaded. Refresh to try again.";
export const DECK_LIST_LATER_CANT = "Later couldn't be loaded. Refresh to try again.";
export const DECK_LIST_HANDED_EMPTY = "Nothing handed off.";
export const DECK_LIST_LATER_EMPTY = "Nothing put off until later.";
export const DECK_LIST_BACK_WITH_YOU = "Back with you";
export const deckListWith = (first: string) => `With ${first}`;
/** The right-hand pill of a Later row: just when it comes back. Today is the bare time. */
export const deckLaterTomorrow = (time: string) => `Tomorrow ${time}`;
export const deckLaterOtherDay = (day: string, time: string) => `${day} ${time}`;
export const deckListDecidedSub = (what: "Approved" | "Rejected" | "Done", time: string, tail: string | null) => (tail ? `${what} ${time} · ${tail}` : `${what} ${time}`);
export const DECK_LIST_TAIL_CLIENT_EMAIL = "client email";
export const DECK_LIST_TAIL_INTERNAL = "internal";
export const DECK_LIST_TAIL_NOTE_KEPT = "note kept";
export const deckListQuote = (note: string) => `“${note}”`;
export const deckListHandedTo = (first: string, when: string, note: string | null) => (note ? `To ${first} ${when} · ${deckListQuote(note)}` : `To ${first} ${when}`);
export const deckListSentBack = (first: string, day: string, time: string) => `To ${first} ${day} · sent back ${time}`;
export const DECK_SIDE_SEE_ALL = "See all";
export const DECK_SIDE_SEE_ALL_DECIDED_LABEL = "See all decided today";
export const DECK_SIDE_SEE_ALL_LATER_LABEL = "See all later";
export const DECK_SIDE_LATER_NOTHING = "Nothing put off.";
export const DECK_SIDE_LATER_CANT = "Can't show Later right now.";
export const DECK_LISTS_CHIP_DECIDED = "Decided";

/* Handed-to-you on the Approvals page and the approval item page (Phase 2 item 2, technician shell). */
export const HANDED_TO_YOU_MARKER = "Handed to you";
export const handedPillLabel = (n: number) => `Handed to you (${n})`;
export const handedToYouAt = (name: string, time: string) => `Handed to you by ${name} · ${time}`;
export const HANDED_NOTE_LABEL = "Their note";
export const sendBackTo = (name: string) => `Send back to ${name}`;
export const SEND_BACK_NOTE_LABEL = "Add a note (optional)";
export const SEND_BACK_NOTE_HINT = "Up to 500 characters. It goes to them with the card.";
export const SEND_BACK_NEEDS_APPROVER = "This one needs an approver's yes. You can edit it and send it back.";
export const sendBackNeedsPerson = (name: string) => `This one is for ${name}. You can edit it and send it back.`;
export const SEND_BACK_DONE = "Sent back. It's on their cards again.";
export const SEND_BACK_NOTE_TOO_LONG = "That note is too long. Keep it to 500 characters.";
export const A_TEAMMATE = "a teammate";
/* The bell: a card handed to someone, or sent back. */
export const NOTICE_HANDED_LABEL = "Handed to you";
export const NOTICE_RETURNED_LABEL = "Sent back";
export const noticeHandedSentence = (first: string) => `${first} handed you an approval`;
export const noticeReturnedSentence = (first: string) => `${first} sent an approval back`;
/* Sprint 4: approved emails passed to the drafter, who makes the draft in their OWN Outlook. */
export const NOTICE_DRAFT_TO_LABEL = "Ready to draft";
export const noticeDraftToSentence = (first: string) => `${first} approved an email · Make the draft`;
export const READY_TO_DRAFT = "Ready to draft";
export const readyToDraftCount = (n: number) => `${READY_TO_DRAFT} (${n})`;
export const MAKE_DRAFT_BUTTON = "Make the draft in my Outlook";
export const MAKE_DRAFT_TITLE = "Make the draft";
export const makeDraftIntro = (approverName: string) =>
  `${approverName} approved this email. Make the draft in your own Outlook, check it there and press Send. Nothing has reached the client yet.`;
export const MAKE_DRAFT_DONE = "The draft is in your Outlook Drafts. Open it there and press Send. Nothing has reached the client yet.";
export const MAKE_DRAFT_ALREADY = "This one is already drafted in your Outlook. Nothing else was made.";
/** The attempt was claimed, the draft failed, and even the failure couldn't be recorded: a person checks it. */
export const MAKE_DRAFT_CLAIMED_FAILED = "The draft couldn't be made. Ask Lectual.";
/** The draft failed and the failure was recorded: the button is offered again. */
export const MAKE_DRAFT_FAILED_RETRY = "The draft couldn't be made. Nothing was sent. Try again.";
export const MAKE_DRAFT_FAILED_RECONNECT = "The draft couldn't be made because your Outlook needs reconnecting. Reconnect it, then try again.";
/** Another click claimed this attempt first (a second tab, a double click). */
export const MAKE_DRAFT_IN_PROGRESS = "This one is already being drafted. Check your Outlook Drafts before trying again.";
/** A claimed attempt with no outcome (a crash in between): never "Drafted". The approved text is shown below it. */
export const MAKE_DRAFT_CHECK_DRAFTS = "Check your Drafts. If it isn't there, copy the approved text below.";
export const MAKE_DRAFT_DONE_NOT_RECORDED = "The draft is in your Outlook Drafts, but Lectual couldn't record it. Don't make it again: check your Drafts.";
export const APPROVED_TEXT_LABEL = "Approved text";
/** On an open claim (drafting, no outcome), for the drafter: records that attempt as failed so it can be made again. */
export const CLEAR_CLAIM_BUTTON = "It isn't in my Drafts, try again";
export const CLEAR_CLAIM_DONE = "Noted. You can make the draft again.";
export const CLEAR_CLAIM_NOTHING_OPEN = "There's no draft waiting to be checked on this one. Refresh to see where it is.";
/** SHOULD 4: the drafter's Ready to draft read failed. */
export const READY_TO_DRAFT_UNCHECKED = "Couldn't check what's ready to draft.";
export const RETRY_PASS_NO_MARKER = "There's no record that passing this one failed, so it can't be passed again from here.";
/* S3: the approver retries a pass that didn't go through. */
export const passToDrafterButton = (name: string) => `Pass to ${name}`;
export const RETRY_PASS_INTRO =
  "This approved email hasn't been passed to the drafter. If passing it didn't go through, pass it again. Use this only if no draft of it was made anywhere.";
export const RETRY_PASS_NOT_YOURS = "Only the person who approved this email can pass it on.";
export const RETRY_PASS_NO_DRAFTER = "There's no one else to pass this to. Check Drafts go to in Approval settings.";
export const RETRY_PASS_ALREADY = "This email has already been passed on. Nothing else was done.";
export const MAKE_DRAFT_NOT_YOURS = "This email isn't waiting on your draft. Refresh to see what's left.";
export const MAKE_DRAFT_NOT_APPROVED = "Only an approved client email can be drafted from here.";
export const MAKE_DRAFT_CHANGED = "This email changed after it was approved, so no draft was made. Ask for it to be approved again.";
export const MAKE_DRAFT_COULDNT_CHECK = "Couldn't check what's ready to draft. Refresh to try again.";
export const MAKE_DRAFT_PREVIEW_ONLY = "Preview only: drafts aren't made while you're viewing as the firm.";
export const MAKE_DRAFT_FAILED = "Couldn't make the draft in your Outlook. Nothing was sent. Refresh to try again.";
export const MAKE_DRAFT_NO_OUTLOOK = "Connect your own Outlook to make drafts here.";
export const MAKE_DRAFT_NOT_OUTLOOK = "Only a Gmail mailbox is connected. Connect your own Outlook to make drafts here.";
export const MAKE_DRAFT_NEEDS_PERMISSION = "Reconnect your Outlook and allow it to save drafts.";
export const MAKE_DRAFT_OUTLOOK_UNREAD = "Couldn't check your Outlook. Refresh to try again.";
export const CONNECT_OUTLOOK_LINK = "Connect Outlook";
export const DRAFTED_IN_OUTLOOK = "Drafted in your Outlook.";
/** The approve outcome when the email was passed to the drafter. */
export const passedToDrafter = (name: string) => `Approved and passed to ${name}, who makes the draft in their own Outlook. Nothing has reached the client yet.`;
export const PASS_FAILED =
  "Approved, but passing it to the drafter didn't go through, so no draft was made anywhere. Open the approval to copy it, or ask Lectual to check.";
/** Before lectual 0112: passing to the drafter isn't on, so the approver's own mailbox was used (today's behaviour). */
export const PASS_NOT_SWITCHED_ON = notReadyYet("Passing approved emails to the drafter");
export const QUEUE_DRAFTED_ANYWAY = "Approved and drafted by the approval queue, so it wasn't passed to the drafter.";
/* Settings -> Approvals: "Drafts go to". */
export const DRAFTS_GO_TO = "Drafts go to";
export const DRAFTS_GO_TO_HELP =
  "When someone else approves a client email, it waits on this person, who makes the draft in their own Outlook and sends it. With nobody chosen, the approver gets the draft, as today.";
export const DRAFTER_OUTLOOK_READY = "Your Outlook is connected and can save drafts.";
export const DRAFTS_GO_TO_NOBODY = "The approver (default)";
export const DRAFTER_DROPPED = "The saved drafter is no longer on your team, so approvers get the drafts until you choose someone.";
/* Phase 2: each person sets their own two deal times (owner view). */
export const DEAL_TIMES_TITLE = "Your deal times";
export const DEAL_TIMES_OPEN = "Change deal times";
export const DEAL_TIMES_MENU_ITEM = "Deal times";
export const DEAL_TIMES_FIRST = "First deal";
export const DEAL_TIMES_SECOND = "Second deal";
export const DEAL_TIMES_NOTE = "Changes only your own deck.";
export const dealTimesZoneLine = (zoneLabel: string) => zoneLabel;
export const DEAL_TIMES_SAVE = "Save";
export const DEAL_TIMES_SAVING = "Saving…";
export const DEAL_TIMES_CANCEL = "Cancel";
export const DEAL_TIMES_NOT_SIGNED_IN = "You are not signed in.";
export const DEAL_TIMES_NOT_SAVED = "We couldn't save your deal times. Try again.";
export const DEAL_TIMES_INVALID = "Pick two times from the lists.";
export const DEAL_TIMES_STEP = "Deal times go in 5-minute steps.";
export const DEAL_TIMES_APART = "Deal times need to be at least 2 hours apart.";

/* Phase 2 item 5: the welcome deal (owner view's first-sign-in guide; the technician view keeps the tour). */
export const WELCOME_SOURCE = "Lectual";
export const WELCOME_TAG = "Welcome · 1 min";
export const WELCOME_SKIP = "Skip the tour";
export const WELCOME_NEXT = "Next";
export const WELCOME_BACK = "Previous step";
export const WELCOME_FORWARD = "Next step";
export const WELCOME_FINISH = "Finish";
export const WELCOME_CARD_1_TITLE = "One card is one thing waiting on you";
export const WELCOME_CARD_1_BODY =
  "Each card says who drafted it, who it is to, and the opening of the draft. Nothing on a card has been sent.";
export const WELCOME_CARD_1_STEP = "when a card has a line at the bottom, it says what to check first.";
export const WELCOME_CARD_2_TITLE = "The moves";
export const WELCOME_CARD_2_BODY = `Yes approves after a 5-second hold you can undo. ${DECK_APPROVING_NEVER_SENDS} A client email becomes a draft in your firm's or your own mailbox, when one is connected. Nothing goes out until someone presses Send there. Reject needs a note. Done marks it handled without approving. Later waits for your next deal; Hand off goes to a colleague. The arrows move between cards.`;
export const WELCOME_CARD_2_STEP = "try the arrows. They only move between cards, and nothing is stored.";
export const WELCOME_CARD_3_TITLE = "Two deals a day";
export const welcomeCard3Body = (first: string, second: string) =>
  `Your cards are dealt at ${first} and ${second}, firm time. Anything that arrives after a deal waits for the next one, or press ${DECK_DEAL_NOW}. The List view shows everything waiting on you, not only this deal.`;
export const WELCOME_CARD_3_STEP = `use "${DEAL_TIMES_OPEN}" in the deck header or "${DEAL_TIMES_MENU_ITEM}" in your account menu to pick your own times.`;
export const WELCOME_CARD_4_TITLE = "The weekly review";
export const WELCOME_CARD_4_BODY = `${REVIEW_NAME} shows your open matters and active leads by person, with ${OUR_TURN} and Waiting on client. It is built for the Monday meeting.`;
export const WELCOME_CARD_4_STEP = "open it before Monday's meeting.";
export const WELCOME_STEPS_NAV = "Steps";
export const welcomeCardOf = (n: number, total: number) => `Card ${n} of ${total}`;

/** Leads page (item L): sets, paging, board, selection. */
export const LEADS_SELECT = "Select";
export const LEADS_SELECT_DONE = "Done selecting";
export const LEADS_SHOW_MORE = (step: number, left: number) => `Show ${step} more (${left} left)`;
export const LEADS_SHOWING = showingOf;
export const LEADS_STAGE_FILTER = "Stage";
export const LEADS_ANY_STAGE = "Every stage";
export const LEADS_SUGGESTIONS = "Suggestions";
export const LEADS_SUGGESTIONS_TITLE = "Leads the system suggests moving to Long-Term Nurture. Nothing moves by itself; open the lead to decide.";
export const LEADS_NEEDS_STAGE = "Needs a stage";
export const LEADS_NO_ACTIVITY_YET = "No activity yet";
export const LEADS_NOTE_UNAVAILABLE = "Note couldn't load";
export const LEADS_LOST_UNAVAILABLE = "Can't show lost leads right now. Refresh to try again.";
export const LEADS_WORKING_UNAVAILABLE = "Can't tell which leads are being worked right now, so every open lead is shown. Refresh to try again.";
export const LEADS_MOVED_TO = (name: string, stage: string) => `Moved ${name} to ${stage}`;
export const LEADS_ASSIGNED_TO = (name: string, who: string) => `Assigned ${name} to ${who}`;
export const LEADS_ROW_MENU = (name: string) => `Actions for ${name}`;
export const LEADS_NO_MATCH_IN_SET = (set: string) => `No lead matches these filters in ${set}.`;
export const LEADS_SET_EMPTY = (set: string) => `Nobody is in ${set} right now.`;
export const LEADS_LOST_CUT = (shown: number, total: number) => `${showingOf(shown, total)} lost leads.`;
export const LEADS_DUPLICATE = "Possible duplicate";
export const LEADS_DUPLICATES = "Possible duplicates";
export const LEADS_DUPLICATES_TITLE = "Leads with the same email or the same name as another open lead. Nothing is merged; open each to compare.";
// Item L2: the Leads list's own columns and chips (Nov 17).
/** The column that holds what the assistants did on a lead (shown only while some lead in view has something). */
export const LEADS_ASSISTANT_COLUMN = "Assistant activity";
export const LEADS_ASSISTANT_SUGGESTS_LTN = "Suggests Long-Term Nurture";
export const LEADS_ASSISTANT_SUGGESTS_LTN_TITLE = "Unbooked by day 10. Moving the lead is your call; nothing changes by itself.";
/** The one column that says whose turn it is. Sorted newest first. */
export const LEADS_CONTACT_COLUMN = LAST_CONTACT;
export const LEADS_TOUCH_OUR_TURN = (date: string) => `${OUR_TURN} · ${date}`;
export const LEADS_TOUCH_WAITING_ON_THEM = (date: string) => `Waiting on them · ${date}`;
export const LEADS_TOUCH_NO_CONTACT = "No contact yet";
/** Only a date is recorded (no email or call), so who is next is not guessed. */
export const LEADS_TOUCH_ACTIVITY_ONLY = (date: string) => `Last activity · ${date}`;
export const LEADS_TOUCH_OUR_TURN_TITLE = "They wrote or called last, so the next reply is ours.";
export const LEADS_TOUCH_WAITING_TITLE = "We wrote or called last, so we are waiting on them.";
export const LEADS_TOUCH_ACTIVITY_ONLY_TITLE = "No email or call is recorded for this lead, so it isn't clear whose turn it is.";
export const LEADS_TOUCH_NONE_TITLE = "Nothing has been recorded for this lead yet.";
/** The word that follows a level the system suggested ("Warm · suggested"). */
export const LEADS_TEMP_SUGGESTED = "suggested";
export const LEADS_RESIZE_COLUMN = (column: string) => `Resize the ${column} column. Use the left and right arrow keys; Home restores the width.`;
// The "Possible duplicate" compare panel: two records side by side. Nothing is merged.
export const LEADS_COMPARE_OPEN = (name: string) => `Compare ${name} with the other lead`;
export const LEADS_COMPARE_TITLE = "Compare possible duplicates";
export const LEADS_COMPARE_NOTE = "Nothing is merged here. Open either lead to decide what to do.";
export const LEADS_COMPARE_CLOSE = "Close";
/** Screen-reader-only header words. */
export const LEADS_COMPARE_FIELD_SR = "Field";
export const LEADS_ACTIONS_SR = "Actions";
export const LEADS_COMPARE_LOADING = "Loading both leads";
export const LEADS_COMPARE_FAILED = "Can't show these leads right now. Close this and try again.";
export const LEADS_COMPARE_GONE = "This lead couldn't be found";
export const LEADS_COMPARE_COULDNT_LOAD = "Couldn't load";
export const LEADS_COMPARE_OPEN_LEAD = (name: string) => `Open ${name}`;
export const LEADS_COMPARE_FIELDS = {
  name: "Name",
  business: "Business or mark",
  email: "Email",
  stage: "Stage",
  source: "Source",
  created: "Created",
  timeline: "Timeline entries",
  tasks: NEXT_STEPS,
  proposals: "Proposals",
} as const;
export const LEADS_MOVED_MARK = "Moved";
export const LEADS_MOVED_MARK_TITLE = "You moved this lead; it no longer belongs in this list. It stays until you refresh.";
export const LEADS_ALL_OPEN_MATCHES = (n: number) => "All open has " + n + (n === 1 ? " match" : " matches");
export const LEADS_START_TIMER = "Start timer";
export const LEADS_STOP_TIMER = "Stop timer";
export const LEADS_ADD_TIME = "Add time";
export const LEADS_UNKNOWN_TEAMMATE_DROP = "That teammate can't be named, so cards can't be dropped there.";
export const LEADS_HIDDEN_SELECTED = (n: number) => `${n} selected but not shown`;

// Matters page: phase groups (pre-filing / post-filing). The owner's names, Nov 12.
export const MATTER_GROUP_LABEL = {
  intake: "Intake",
  pre: "Pre-filing",
  post: "Post-filing",
  other: "Matters",
} as const;
export const MATTER_GROUPS_NAV = "Matter group";
export const MATTER_STATUS_NAV = "Filter matters";
export const MATTER_PHASES_UNAVAILABLE = "Can't show the Pre-filing and Post-filing groups right now, so every matter is shown together. Refresh to try again.";
export const MATTER_GROUP_ALL = "All";
export const MATTER_GROUP_EMPTY = (group: keyof typeof MATTER_GROUP_LABEL | "all") =>
  group === "all"
    ? "No matters match these filters."
    : group === "other"
      ? "No contracts or one-offs match these filters."
      : `No matters in ${MATTER_GROUP_LABEL[group]} match these filters.`;
export const MATTER_MOVED_TO = "Moved to";
export const MATTER_INTAKE_STAGES = (n: number, matching = false) =>
  `${n} ${matching ? "matching " : ""}${n === 1 ? "matter is" : "matters are"} in intake stages`;
export const MATTER_INTAKE_SHOW = "Show them";
/** Phases are set but no signed-engagement stage was found, so every intake-phase stage is treated as intake. */
export const MATTER_NO_HIRED_STAGE = "No signed-engagement stage was found, so matters on every intake stage are left out here. Check your matter stage names.";
export const MATTER_SHOWING_INTAKE = "Showing matters still in intake stages.";
export const MATTER_BACK_TO_PAST_INTAKE = "Back to matters";
export const MATTER_ALL_INTAKE_TITLE = "No matters past intake yet";
export const MATTER_ALL_INTAKE_BODY = "Every matter is still in an intake stage. A matter shows here once it reaches the signed engagement.";

// M5: merge duplicate leads (lectual 0107). Owner, admin and senior admin only.
export const MERGE_LEADS_TITLE = "Merge two leads";
export const MERGE_LEADS_LINK = "Merge…";
export const MERGE_LEADS_LINK_TITLE = "Choose which lead to keep and merge the other into it";
export const MERGE_LEADS_SUB = "One lead is kept. The other is merged into it and stops showing in lists. Its history stays readable on the lead you keep.";
export const MERGE_KEEP_INSTEAD = "Keep this lead instead";
export const MERGE_KEEPING = "Keeping";
export const MERGE_INTO_KEEPER = "Merged into the kept lead";
export const MERGE_KEEP_WHY = {
  matter: "Suggested because it has a matter.",
  lawmatics: "Suggested because it is linked to Lawmatics.",
  older: "Suggested because it is the older lead.",
  chosen: "You chose this lead.",
} as const;
export const MERGE_FIELDS_HEADING = "Which details to keep";
export const MERGE_FIELDS_NOTE = "Where the two leads differ, pick the value to keep. The stage of the kept lead never changes.";
export const MERGE_FIELDS_SAME = "The details match. Nothing to choose.";
export const MERGE_FIELD_LABELS = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  business_name: "Business",
  website: "Website",
  mark_text: "Mark",
  referral_source: "Source",
  referral_detail: "Source detail",
  practice_area: "Practice area",
  assigned_to: OWNER_COLUMN,
  temperature: "Suggested temperature",
  lane: "Temperature",
} as const;
export const MERGE_EMPTY_VALUE = "Empty";
export const MERGE_STAGE_LABEL = "Stage";
export const MERGE_MOVES_HEADING = "Moves to the kept lead";
export const MERGE_STAYS_HEADING = "Stays on the merged lead, shown on the kept lead";
export const MERGE_COUNT_UNAVAILABLE = "Couldn't load";
export const MERGE_COUNTS_NOTE = "Counts are for the lead being merged. Tags are added to the kept lead's tags. A campaign the kept lead is already in is stopped on the merged lead instead of moved.";
export const MERGE_COUNT_LABELS = {
  tasks: NEXT_STEPS,
  time: "Time entries",
  matters: "Matters",
  meetings: "Meetings",
  calendar: "Calendar events",
  discovery: "Discovery sessions",
  scorecards: "Booth scorecards",
  submissions: "Form answers",
  consultNotes: "Consult notes",
  enrollments: "Campaigns",
  tags: "Tags",
  activity: "Timeline entries",
  files: "Files",
  proposals: "Proposals",
  quotes: "Quotes",
} as const;
export const MERGE_MATTER_NOTE = (matter: string, keeper: string) => `${matter} belongs to the lead being merged. After the merge it belongs to ${keeper}.`;
export const MERGE_BUTTON = "Merge leads";
export const MERGE_CONFIRM = (loser: string, keeper: string) => `Merge ${loser} into ${keeper}? This can't be undone from Lectual.`;
export const MERGE_CONFIRM_LABEL = "Merge";
export const MERGE_PENDING = "Merging…";
export const MERGE_BACK = "Back to Intake";
export const MERGE_PICK_TWO = "Choose two different leads to merge. Open a possible duplicate from Intake and choose Merge.";
export const MERGE_LEAD_GONE = "One of these leads couldn't be found. It may have been deleted.";
export const MERGE_LEAD_ALREADY = (name: string) => `${name} has already been merged into another lead.`;
export const MERGE_OPEN_KEEPER = "Open the lead it was merged into";
export const MERGE_NOT_A_LEAD = "This is a matter, not a lead. A lead and a matter can't be merged. Open the matter and link the lead to it there.";
export const MERGE_OPEN_MATTER = "Open the matter";
export const MERGE_READ_FAILED = "Can't show these leads right now. Refresh to try again.";
/** The quiet line on the kept lead after a merge, and on a merged lead's old link. */
export const MERGE_DONE = "Merged. The other lead's history is shown here.";
export const LEAD_MERGED_INTO = (name: string) => `This lead was merged into ${name}.`;
export const MERGE_HISTORY_PARTIAL = "History from merged leads couldn't be loaded. Refresh to try again.";
/** Any write that reached a merged lead (lectual 0107's crm_lead_merge_guard). */
export const LEAD_MERGED_WRITE = "This lead was merged into another lead, so it can't be changed here. Refresh and open the lead it was merged into.";
/** The Lawmatics importer's reason for a person whose lead was merged. */
export const LEAD_MERGED_IMPORT_SKIP = (keeper: string | null) =>
  keeper
    ? `This person's lead was merged into ${keeper} in Lectual, so the import leaves it alone.`
    : "This person's lead was merged into another lead in Lectual, so the import leaves it alone.";
/** crm_merge_leads refusals, by the prefix lectual 0107 raises. */
export const MERGE_REFUSALS = {
  merge_not_allowed: "Only an owner or admin can merge leads.",
  merge_same_record: "Those are the same lead. Choose two different leads.",
  merge_not_found: "One of these leads couldn't be found. It may have been deleted.",
  merge_already_merged: "One of these leads has already been merged. Refresh to see where it went.",
  merge_chain: "Other leads were already merged into the lead you chose to merge. Keep this lead and merge the other into it.",
  merge_open_payment: "A card payment on one of these leads is still being processed. Wait for it to finish, then merge.",
  merge_proposal_unpaid: "One of these leads has an accepted proposal that isn't paid yet, so it can't be merged now.",
  merge_bad_choice: "One of the choices wasn't recognised. Refresh the page and choose again.",
} as const;
export const MERGE_FAILED = "Couldn't merge these leads. Try again.";
/** An automation rule whose lead can no longer be found. */
export const MERGE_RULE_LEAD_GONE = "The lead couldn't be found.";
/** An agent run that found a lead merged between its read and its write (counted, never an error). */
export const MERGE_AGENT_SKIPPED = (n: number) => `${n} ${n === 1 ? "lead was" : "leads were"} skipped: merged into another lead.`;
/** A write from a page opened before a merge, when the merged lead's pointer can't be read: nothing is written. */
export const MERGE_POINTER_UNREADABLE = "This lead couldn't be checked just now, so nothing was saved. Refresh and try again.";
/** An automation rule whose lead couldn't be read (a failed read, not a merge). */
export const MERGE_RULE_LEAD_UNREADABLE = "The lead couldn't be read, so this action was skipped.";
/** The lead page when its own timeline rows (suggestions, proposals from email) couldn't be read. */
export const MERGE_OWN_ROWS_UNAVAILABLE = "Suggestions and proposals from email couldn't be loaded. Refresh to try again.";
/** An assessment that is scored (the booth card or the firm's assessment page), on the Forms list, its results page and the lead's Answers card. */
export const SCORED_ASSESSMENT = "Scored assessment";
export const SCORED_ASSESSMENTS = "Scored assessments";

// Area G
/** The workspace's own error page (a page's server work failed): the line under "Can't show this page right now". */
export const PAGE_DIDNT_ANSWER = "Nothing is missing. The page just didn't answer. Refresh to try again, or go back to the page you were on.";
/** The shell's 404 and no-firm pages. */
export const NOT_FOUND_TITLE = "This page doesn't exist";
export const NOT_FOUND_BODY = "The link may be out of date, or the page may have moved.";
export const GO_BACK = "Go back";
export const NO_FIRM_ACCESS_TITLE = "No firm access yet";
export const REFRESH_MY_ACCESS = "Refresh my access";
export const WRONG_ACCOUNT_SIGN_OUT = "Wrong account? Sign out";
export const NO_FIRM_JUST_INVITED = "Just been invited? Your sign-in predates the invite. Refresh to pick up your firm.";
/** The bar across the top while Lectual staff are inside a firm they are not a member of. */
export const staffInsideFirm = (firmName: string) => `Lectual staff · you are inside ${firmName}, a firm you are not a member of. This visit is logged.`;

// Area B (Matters, Pipeline, Documents, Files)
export const MATTERS_NAME = "Matters";
export const DOCUMENTS_NAME = "Documents";
export const NEW_LETTER = "New letter";

// Review documents
/** The weekly review's Cards deck: a record's documents. (An opened record uses the Documents & files card.) */
export const REVIEW_DOCS_TITLE = "Documents";
export const REVIEW_DOCS_EMPTY = "No documents yet.";
export const reviewDocsMore = (n: number, capped = false) => (capped ? `+${n} or more` : `+${n} more`);
export const REVIEW_DOCS_LOAD_FAILED = "Documents couldn't be loaded.";
export const reviewDocsCount = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

// Lead step
/** The lead page's top card ("where Lectual does the step") and "What Lectual did" (src/lib/lead-step/). */
export const LEAD_STEP_NEEDS_YES = "Needs your yes";
export const leadStepNeedsYesOf = (name: string) => `Needs ${name}'s yes`;
export const LEAD_STEP_NEEDS_AN_APPROVER = "Needs an approver's yes";
export const LEAD_STEP_HAS_IT = "Lectual has it";
export const LEAD_STEP_YOURS = "Yours to do";
export const LEAD_STEP_OVERDUE = "Overdue";
export const LEAD_STEP_NOT_PREPARED = "Lectual hasn't prepared this yet";
export const LEAD_STEP_QUIET = "Nothing is lined up";
export const LEAD_STEP_CANT_SHOW_NEEDS = "Can't show what needs you right now. Refresh to try again.";
export const LEAD_STEP_CANT_SHOW_NEXT = "Can't show what Lectual will do next. Refresh to try again.";
export const LEAD_STEP_APPROVALS_OFF = "Approvals aren't connected for your firm, so Lectual can't prepare drafts for a yes. Lectual will turn it on.";
export const LEAD_STEP_SET_NEXT_STEP = "Set a next step";
export const leadStepOthers = (n: number) => `${n} more waiting for a yes on this lead`;
export const leadStepMoreSteps = (n: number) => `${n} more open ${n === 1 ? "step" : "steps"}`;
/** The buttons. Yes is held for 5 seconds with Undo before anything is posted (the deck's rule). */
export const LEAD_STEP_YES = "Yes";
export const LEAD_STEP_EDIT = "Edit";
export const LEAD_STEP_NOT_THIS = "Not this";
export const LEAD_STEP_REASON_LABEL = "Short reason, so Lectual learns";
export const LEAD_STEP_DROP = "Drop this draft";
export const LEAD_STEP_UNDO = "Undo";
export const LEAD_STEP_OPEN_PROPOSAL = "Open the proposal";
export const LEAD_STEP_DRAFT_PROPOSAL = "Draft proposal, not live yet";
export const LEAD_STEP_TO = "To";
export const LEAD_STEP_SUBJECT = "Subject";
/** Read-only: who the yes is waiting on. */
export const leadStepWaitingOn = (who: string) => `Waiting on ${who}'s yes`;
export const LEAD_STEP_WAITING_ON_APPROVER = "Waiting on an approver's yes";
export const LEAD_STEP_PREVIEW_ONLY = "Preview only: you can't approve while you're viewing as the firm.";
export const LEAD_STEP_CLOSER_LOOK = "This draft needs a closer look before a yes. Open it in Approvals.";
export const LEAD_STEP_CANT_CHECK = "This draft couldn't be checked just now, so it can't be approved here. Open it in Approvals.";
/** The action results. Fixed sentences only. */
export const LEAD_STEP_NOT_ON_LEAD = "This draft isn't on this lead any more. Refresh to see what's next.";
export const LEAD_STEP_REASON_NEEDED = "Add a short reason first, up to 200 characters.";
export const LEAD_STEP_DROPPED = "Dropped. Lectual won't use this draft. Nothing was sent.";
export const LEAD_STEP_EDIT_SAVED = "Saved. Nothing was sent.";
export const LEAD_STEP_EDIT_EMPTY = "The draft can't be empty.";
export const LEAD_STEP_FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";
export const LEAD_STEP_NO_EDIT = "You don't have permission to edit drafts.";
/** After a yes: only what the approve core reports really happened. */
export const leadStepDraftInMailbox = (owner: string | null, mailbox: "Outlook" | "Gmail") =>
  owner
    ? `Approved. The draft is in ${owner}'s ${mailbox}. Nothing is sent until ${owner} presses Send.`
    : `Approved. The draft is in your ${mailbox}. Nothing is sent until you press Send.`;
export const LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX = "Approved. The approval queue put the draft in the firm's mailbox Drafts. Nothing is sent until someone presses Send.";
export const LEAD_STEP_APPROVED_NO_DRAFT = "Approved. No mailbox draft was made, so nothing reached a mailbox and nothing was sent. Open the approval to copy it.";
export const LEAD_STEP_APPROVED_DRAFT_FAILED = "Approved, but the draft couldn't be made, so nothing reached a mailbox. Open the approval to copy it.";
export const LEAD_STEP_APPROVED_MANUAL = "Approved. This type isn't emailed: file or deliver it the usual way.";
export const LEAD_STEP_APPROVED = "Approved.";
/** "Lectual has it": what it waits for, what it does next, and when (only a job that is switched on). */
export const leadStepWaitingForConsult = (day: string) => `Waiting for the consult on ${day}`;
export const LEAD_STEP_WAITING_FOR_RUN = "Waiting for the next morning run";
export const leadStepPrepPromise = (day: string, from: string, to: string, withEmail: boolean) =>
  `${day}, between ${from} and ${to}, Lectual prepares a consult heads-up${withEmail ? " and the client's prep email" : ""}, then asks for your yes.`;
export const leadStepProposalAfterConsult = (day: string, from: string, to: string) =>
  `After the consult, once the recording is imported and linked to this lead, Lectual reads the recording and drafts the proposal if it fits, then asks for your yes. The earliest is ${day}, between ${from} and ${to}.`;
export const leadStepProposalFromRecording = (day: string, from: string, to: string) =>
  `${day}, between ${from} and ${to}, Lectual reads the recording and drafts the proposal if it fits, then asks for your yes.`;
/** Why nothing is promised, and what a person does instead. */
export const LEAD_STEP_OFF: Record<string, string> = {
  "assistants-off": "Lectual's assistants aren't switched on for your firm, so nothing is lined up. Set a next step instead.",
  "ai-off": "Lectual's assistants aren't switched on for your firm yet, so nothing is lined up. Set a next step instead.",
  paused: "Lectual's assistants are paused, so nothing is lined up. Set a next step instead.",
  "assistant-off": "The assistant that would do this is switched off in Assistants, so nothing is lined up. Set a next step instead.",
  "suggest-only": "The assistant that would do this only makes suggestions, so nothing is lined up. Set a next step instead.",
  "approvals-off": "Approvals aren't connected for your firm, so nothing is lined up. Set a next step instead.",
  "mailbox-off": "Consult prep reads the Outlook calendar, which isn't switched on for your firm. Set a next step instead.",
  "proposals-off": "Proposals aren't switched on for your firm, so Lectual won't draft one. Set a next step instead.",
  "no-approvers": "No one is named to approve proposals yet, so Lectual won't draft one. Name an approver in Settings, or set a next step.",
  "no-recordings": "No meeting recorder is connected, so Lectual won't read the consult. Connect Fathom or Zoom, or set a next step.",
};
/** "Lectual hasn't prepared this yet": the draft no assistant makes today, by name. Never a made-up draft. */
export const LEAD_STEP_GAP: Record<"payment-nudge" | "follow-up" | "outcome-read" | "first-reply", string> = {
  "payment-nudge": "A reminder to pay the legal fee. Lectual doesn't draft it yet: write it yourself, or set a next step.",
  "follow-up": "A follow-up on the proposal. Lectual doesn't draft the day-by-day proposal follow-ups yet: write one yourself, or set a next step.",
  "outcome-read": "Reading the consult to propose the outcome. Lectual doesn't do this yet: log the consult outcome yourself.",
  "first-reply": "The first reply to this enquiry. Lectual doesn't draft it yet: write it yourself, or set a next step.",
};
export const leadStepFollowUpDay = (day: number) => `Proposal out, day ${day} of 7`;
export const LEAD_STEP_QUIET_NOTE = "Nothing is waiting on Lectual or on you for this lead. Set a next step if something should happen.";
/** The four facts. */
export const LEAD_STEP_FACT_CONTACT = "Last contact";
export const LEAD_STEP_FACT_CONSULT = "Consult";
export const LEAD_STEP_FACT_PROPOSAL = "Proposal";
export const LEAD_STEP_FACT_WAITING = "Waiting on";
export const LEAD_STEP_COULDNT_LOAD = "Couldn't load";
export const LEAD_STEP_NO_CONTACT = "No contact yet";
export const LEAD_STEP_CONTACT_OFF = "Contact from mail isn't switched on";
export const LEAD_STEP_THEY_WROTE = "They wrote last";
export const LEAD_STEP_WE_WROTE = "We wrote last";
export const LEAD_STEP_THEIR_TURN = "Their turn";
export const LEAD_STEP_NOT_BOOKED = "Not booked";
export const leadStepConsultHeld = (day: string) => `Held ${day}`;
export const LEAD_STEP_NO_PROPOSAL = "None yet";
export const LEAD_STEP_PROPOSAL_DRAFT = "Draft saved, link not live";
export const LEAD_STEP_PROPOSAL_SAVED = "Saved, link not live";
export const LEAD_STEP_PROPOSAL_LIVE = "Link live";
export const leadStepOpened = (n: number) => (n === 0 ? "Not opened yet" : `Opened ${n === 1 ? "once" : `${n} times`}`);
export const LEAD_STEP_OPENS_UNAVAILABLE = "Opens couldn't load";
export const leadStepLastDay = (day: string) => `Last day ${day}`;
export const leadStepAccepted = (day: string | null, signed: boolean) => `${signed ? "Accepted and signed" : "Accepted"}${day ? ` ${day}` : ""}`;
export const LEAD_STEP_PAID = "Paid";
export const LEAD_STEP_NOT_PAID = "Not paid";
export const LEAD_STEP_PAID_UNAVAILABLE = "Paid status couldn't load";
export const LEAD_STEP_PROPOSAL_CLOSED = "No live proposal";
export const LEAD_STEP_WAIT_APPROVAL = "Approval";
export const LEAD_STEP_WAIT_LECTUAL = "Lectual";
export const LEAD_STEP_WAIT_US = "Us";
export const LEAD_STEP_WAIT_PERSON = "A person does this";
export const LEAD_STEP_YOUR_YES = "Your yes";
/** "What Lectual did": the assistants' work on this lead, newest first. */
export const LEAD_STEP_DID_TITLE = "What Lectual did";
export const LEAD_STEP_DID_EMPTY = "Nothing yet.";
export const LEAD_STEP_DID_UNAVAILABLE = "Couldn't load what Lectual did. Refresh to try again.";
export const LEAD_STEP_DID_UNDONE = "Undone";
export const leadStepMoved = (to: string | null) => (to ? `Moved to ${to}` : "Moved the lead forward");
export const LEAD_STEP_DID_PREP_BRIEF = "Built the consult heads-up";
export const LEAD_STEP_DID_PREP_EMAIL = "Drafted the client's prep email";
export const LEAD_STEP_DID_FOLLOW_UP = "Drafted a follow-up email";
export const LEAD_STEP_DID_PROPOSAL = "Drafted the proposal and its email from the consult";
export const LEAD_STEP_DID_POST_CONSULT = "Drafted the follow-up email from the consult notes";
export const LEAD_STEP_DID_DRAFT = "Drafted something for a yes";
export const LEAD_STEP_DID_FIRST_READ = "Wrote the first read of this lead";
export const LEAD_STEP_DID_FROM_EMAILS = "Read their emails and suggested changes";
export const leadStepDidSuggested = (to: string | null) => (to ? `Suggested moving to ${to}` : "Suggested a stage move");
export const LEAD_STEP_DID_FILED_IN = "Filed an email from them on this lead";
export const LEAD_STEP_DID_FILED_OUT = "Filed an email the firm sent on this lead";
export const LEAD_STEP_DID_CREATED = "Created the lead";
export const LEAD_STEP_DID_SEQUENCE_STOPPED = "Stopped a campaign";
export const LEAD_STEP_ROW_VERSION = "Version";
export const LEAD_STEP_ROW_LEGAL = "Legal fee";
export const LEAD_STEP_ROW_USPTO = "USPTO fees";
export const LEAD_STEP_NO_APPROVE = "You don't have permission to approve or reject client communications.";
export const LEAD_STEP_ALREADY_DECIDED = "This draft was already decided. Refresh to see what's next.";
export const LEAD_STEP_APPROVED_LETTER = "Approved. The letter document is made from the approved text and listed under Documents; if it couldn't be made, Documents says so. Nothing was sent.";
export const LEAD_STEP_DID_CUT = "Only what is in the newest 100 timeline entries is listed here.";
export const LEAD_STEP_STALLED_MAY_DRAFT = "The morning brief may still draft a follow-up if the lead goes quiet; it would ask for a yes.";
export const LEAD_STEP_FOLLOW_UP_PASSED = "The proposal's follow-up window has passed";
export const LEAD_STEP_FOLLOW_UP_PASSED_TEXT = "Lectual doesn't suggest what comes after the last day yet: decide it yourself (a new version, or Long-Term Nurture), or set a next step.";
export const leadStepHandedToYou = (by: string) => `Handed to you by ${by}`;
export const leadStepHandedTo = (name: string) => `Handed to ${name}`;
export const LEAD_STEP_A_TEAMMATE = "a teammate";
export const LEAD_STEP_SEND_BACK = "Send back";
export const LEAD_STEP_SENT_BACK = "Sent back. Nothing was sent to the client.";
export const LEAD_STEP_HANDED_AWAY = "You handed this card on, so its yes isn't offered to you here.";
export const LEAD_STEP_LINK_NOT_LIVE = "A yes here would turn the proposal's client link on. Review the proposal, then open this in Approvals.";
export const LEAD_STEP_ROW_PROPOSAL = "Proposal";
// Leads: a booked consult in the Last contact cell
export const LEADS_TOUCH_CONSULT_TODAY = (time: string) => `Consult today · ${time}`;
export const LEADS_TOUCH_CONSULT_LATER = (date: string) => `Consult · ${date}`;
export const LEADS_TOUCH_CONSULT_HELD = (date: string) => `${OUR_TURN} · consult ${date}`;
export const LEADS_TOUCH_CONSULT_HELD_TITLE = "The consult was held and nothing has been sent since.";
export const LEADS_TOUCH_CONSULT_TITLE = "A consult is booked on the calendar, so that is the next thing for this lead.";
// Record card (Sprint 10: edit on the card, and the opened card)
export const RECORD_CARD_SAVED = "Saved";
export const RECORD_CARD_NOT_FOUND = "This record couldn't be found.";
export const RECORD_CARD_UNAVAILABLE = "This record couldn't be loaded.";
export const RECORD_CARD_GONE = "That record couldn't be found. It may have been removed.";
export const RECORD_CARD_NO_PERMISSION = "You don't have permission to change this. Ask an attorney or an admin.";
export const RECORD_CARD_CHECK_FIELDS = "Check the highlighted fields.";
export const RECORD_CARD_RENAME_FAILED = "Couldn't save the name.";
export const RECORD_CARD_RENAME_NOTHING = "Change the name or the business first.";
export const RECORD_CARD_TAG_CHOOSE = "Choose a tag.";
export const RECORD_CARD_TAG_NOT_FIRM = "That tag isn't one of your firm's tags.";
export const RECORD_CARD_TAG_ALREADY = "This tag is already on the lead.";
export const RECORD_CARD_TAG_NOT_ON = "This tag isn't on the lead.";
export const RECORD_CARD_NAME_CHARS = "Use letters, numbers and ordinary punctuation only.";
export const RECORD_CARD_TAG_ADD_FAILED = "Couldn't add this tag.";
export const RECORD_CARD_TAG_REMOVE_FAILED = "Couldn't remove this tag.";
export const RECORD_CARD_SUGGESTED_MARK = "suggested";
export const recordCardSuggests = (level: string) => `Lectual suggests ${level} · Accept`;
export const recordCardNeedsAttorney = (n: number) => `Needs attorney · ${n}`;
export const RECORD_CARD_APPROVALS_FAILED = "Approvals couldn't load";
export const RECORD_CARD_STEPS_FAILED = "Couldn't load next steps";
export const RECORD_CARD_NO_STEP = "No next step";
export const RECORD_CARD_ADD_STEP = "Add a next step";
export const RECORD_CARD_UNASSIGNED = "Unassigned";
export const RECORD_CARD_A_TEAMMATE = "A teammate";
/** A step's "who" picker: the step's current assignee is not in the team list (`stepAssigneeOptions`). */
export const STEP_ASSIGNEE_NOT_ON_TEAM = "Someone no longer on the team";
export const RECORD_CARD_NO_ACTIVITY = "No activity yet";
export const RECORD_CARD_ACTIVITY_FAILED = "Couldn't load last activity";
export const recordCardLastActivity = (when: string) => `Last activity ${when}`;
export const recordCardDue = (when: string) => `due ${when}`;
export const RECORD_CARD_NO_DATE = "No date set";
export const RECORD_CARD_MENU_MOVE = "Move to stage…";
export const RECORD_CARD_MENU_STEP = "Set next step";
export const RECORD_CARD_MENU_NO_SHOW = "Mark no-show";
export const RECORD_CARD_MENU_MERGE = "Merge duplicates";
export const RECORD_CARD_MENU_OPEN = "Open full page";
export const RECORD_CARD_DEADLINE_CONFIRMED = "Confirmed by an attorney";
export const RECORD_CARD_DEADLINE_UNCONFIRMED = "Unconfirmed";
export const recordCardDeadline = (when: string) => `USPTO deadline ${when}`;
export const RECORD_CARD_NO_DEADLINE = "No open USPTO deadline";
export const RECORD_CARD_CALL = "Call";
export const RECORD_CARD_EMAIL = "Email";
// Part 2: the controls and the opened card
export const RECORD_CARD_SAVING = "Saving…";
export const RECORD_CARD_SET_BTN = "Set";
export const RECORD_CARD_SUGGESTED_TITLE = "Lectual suggested this. Nobody has set it yet.";
export const RECORD_CARD_NO_SOURCE = "Source —";
export const recordCardOpenLabel = (name: string) => `Open ${name}`;
export const recordCardControlLabel = (what: string, name: string) => `${what} for ${name}`;
export const RECORD_CARD_STEP_TITLE = "Next step";
export const RECORD_CARD_STEP_DUE = "Due date";
export const RECORD_CARD_STEP_SAVE = "Save";
export const RECORD_CARD_STEP_ADD = "Add";
export const RECORD_CARD_STEP_DONE = "Done";
export const RECORD_CARD_STEP_SNOOZE = "Snooze";
export const RECORD_CARD_STEPS_HEADING = "Next steps";
export const RECORD_CARD_NO_STEPS = "No open next steps.";
export const RECORD_CARD_NOTE_HEADING = "Add to the timeline";
export const RECORD_CARD_TIMELINE = "Timeline";
export const RECORD_CARD_TAGS = "Tags";
export const RECORD_CARD_NO_TAGS = "No tags.";
export const RECORD_CARD_ADD_TAG = "Add a tag";
export const RECORD_CARD_REMOVE_TAG = (label: string) => `Remove tag ${label}`;
export const RECORD_CARD_CONTACT = "Contact";
export const RECORD_CARD_NO_CONTACT = "No phone or email on file.";
export const RECORD_CARD_CONTACT_NOTE = "These open your own phone or mail app. Nothing is sent from Lectual.";
export const RECORD_CARD_PROPOSAL = "Proposal";
export const RECORD_CARD_NO_PROPOSAL = "No proposal yet.";
export const RECORD_CARD_OPEN_PROPOSAL = "Open the proposal";
export const RECORD_CARD_DEADLINE_HEAD = "Next USPTO deadline";
export const RECORD_CARD_DEADLINE_NOTE = "Read only here. Confirm or close a deadline on the matter page.";
export const RECORD_CARD_NAME = "Name";
export const RECORD_CARD_BUSINESS = "Business";
export const RECORD_CARD_TITLE = "Title";
export const RECORD_CARD_STAGE = "Stage";
export const RECORD_CARD_SOURCE = "Source";
export const RECORD_CARD_OWNER = "Owner";
export const RECORD_CARD_MENU_LABEL = (name: string) => `More for ${name}`;
export const recordCardNoShowHeld = (name: string) => `Logging a no-show for ${name}…`;
export const RECORD_CARD_NO_SHOW_UNDO = "Undo";
export const RECORD_CARD_NO_SHOW_UNDONE = "Not logged.";
export const RECORD_CARD_NO_SHOW_NOTE = "Optional note";
export const RECORD_CARD_NO_SHOW_DONE = "No-show logged.";
export const RECORD_CARD_NO_SHOW_PAUSED = "Paused while you type. It logs 5 seconds after you leave the note.";
export const recordCardNoShowNotLogged = (name: string) => `No-show not logged for ${name}. The card closed before it was saved. Mark it again if it should be logged.`;
export const RECORD_CARD_NO_SHOW_DISMISS = "Dismiss";
/** A role that may not move a lead's stage (Intake's move: checked before the lead or stage is read). */
export const MOVE_STAGE_NO_PERMISSION = "You don't have permission to move this lead to that stage — ask an attorney, admin, or intake lead.";
export const RECORD_CARD_CLOSE_LABEL = "Close";
export const RECORD_CARD_OPENED_LABEL = "Record";
export const RECORD_CARD_ID_NAMES = "Names";
export const RECORD_CARD_MOVE_PLACEHOLDER = "Move to stage…";
export const RECORD_CARD_STAGE_READ_ONLY = "Stages couldn't load, so the stage can't be changed here.";
export const RECORD_CARD_PEOPLE_READ_ONLY = "The team list couldn't load, so the owner can't be changed here.";

// Review fixes (2026-11-17)
/** The busy word on a search button (a search is not a save). */
export const SEARCHING = "Searching…";
/** A list cut off at its cap where the real total is not known: "Showing 200 of 200+". */
export const showingAtLeast = (shown: number): string => showingOf(shown, shown) + "+";
/** The Forms results table heading. */
export const ALL_FORMS = `All ${FORMS_NAME.toLowerCase()}`;
export const ADD_ANOTHER_NEXT_STEP = "Add another next step";

// Lead page
/** The lead page's top card controls, "What Lectual did" and the four facts (Sprint 9 Part 2). Wording of the card itself is in `// Lead step`. */
export const LEAD_PAGE_FACTS_LABEL = "Where this lead stands";
export const LEAD_PAGE_WHY = "Why:";
export const LEAD_PAGE_CHECK_FIRST = "Check first:";
export const LEAD_PAGE_SHOW_WHOLE_DRAFT = "Show the whole draft";
export const LEAD_PAGE_DRAFT_LABEL = "Draft";
export const LEAD_PAGE_EDIT_SAVE = "Save edit";
export const LEAD_PAGE_DONE_EDITING_YES = "Save or cancel your edit first, then say yes.";
export const LEAD_PAGE_OPEN_IN_APPROVALS = "Open in Approvals";
export const LEAD_PAGE_SEND_BACK_NOTE = "Note for them (optional)";
export const LEAD_PAGE_SEND_BACK_GO = "Send this back";
export const LEAD_PAGE_ACTION_FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";
export const LEAD_PAGE_MARK_DONE = "Mark done";
export const LEAD_PAGE_SNOOZE = "Snooze";
export const LEAD_PAGE_CHANGE = "Change";
export const LEAD_PAGE_SAVE_STEP = "Save next step";
export const LEAD_PAGE_STEP_LABEL = "Next step";
export const LEAD_PAGE_STEP_WHAT = "What happens next";
export const LEAD_PAGE_STEP_DUE = "Due date";
export const LEAD_PAGE_STEP_OWNER = "Assigned to";
export const LEAD_PAGE_DID_ALL = (n: number) => `Show all (${n})`;
export const LEAD_PAGE_APPROVALS_LINK = "See them in Approvals";
export const LEAD_PAGE_YES_UNCONFIRMED = "We couldn't confirm that. Check Approvals before trying again. Nothing was sent.";
/** Yes approves only the text that was shown: the draft was edited (or changed) after the card was drawn. */
export const DRAFT_CHANGED_REFRESH = "The draft changed. Refresh to see it.";
export const LEAD_PAGE_STALE_DRAFT = "This client's status changed since the draft was queued, so it can't be approved from here. Open it in Approvals to decide.";
export const LEAD_PAGE_ALSO_WAITING = "Also waiting on this lead";
export const LEAD_PAGE_BRIEFINGS = "Internal briefings for this lead";
export const leadPageQueued = (day: string) => `queued ${day}`;
export const leadPageMoreInApprovals = (n: number) => `${n} more in Approvals`;
export const leadStepTheyLastWrote = (day: string) => `They last wrote ${day}`;
// PGE Sprint 1: sync check and first-user readiness
/** The stamps a change is credited to. A person is named by first name from the member directory. */
export const CHANGED_BY_LAWMATICS_SYNC = "Lawmatics sync";
export const CHANGED_BY_AUTOMATION = "an automation";
export const CHANGED_BY_ASSISTANT = "an assistant";
export const UPDATED_AUTOMATICALLY = "Updated automatically";
export const CAME_IN_THROUGH_A_FORM = "Came in through a form";
/**
 * Weekly review's last-changed line when the form's staff name could be read (Taylor, Nov 23): "Came in through the UGW 2026 form".
 * A name that already ends in "form" (a word or part of one, "Webform") is not given a second one. Any other case (failed read, no form, empty name) is CAME_IN_THROUGH_A_FORM.
 */
export function cameInThroughForm(name: string): string {
  return /form$/i.test(name) ? `Came in through the ${name}` : `Came in through the ${name} form`;
}
export const OPENED_WHEN_CLIENT_SIGNED = "Opened when the client signed";
/** The Stage Keeper is never named to a firm (the glossary bans it): its move reads as an automatic one. */
export const changedAutomaticallyLine = (when: string) => `Changed automatically · ${when}`;
/** The weekly review's quiet "last changed" line. A date is "Nov 16". */
export const changedByLine = (who: string, when: string) => `Changed by ${who} · ${when}`;
export const NOT_CHANGED_SINCE_IMPORT = "Not changed since import";
export const NO_CHANGES_LAST_YEAR = "No changes in the last year";
export const LAST_CHANGED_LABEL = "Last changed";

/** Settings → Setup → Team accounts. */
export const TEAM_ACCOUNTS_NAME = "Team accounts";
export const TEAM_ACCOUNTS_SUB = "Each person's role and Outlook, read from what is saved. Nothing here sends mail or changes anything.";
export const TEAM_ACCOUNTS_CANT_CHECK = "Team accounts couldn't be checked right now. Refresh to try again.";
export const TEAM_ACCOUNTS_OUTLOOK = "Outlook connected";
export const TEAM_ACCOUNTS_DRAFTS = "Can receive drafts";
export const TEAM_ACCOUNTS_YOU = "You";
/** A colleague's personal mailbox is hidden by the database from everyone but them (and, through Lectual's owner view, the owner). */
export const onlyCanSeeThis = (first: string | null) => `Only ${first ?? "that person"} can see this`;
export const TEAM_ACCOUNTS_PRIVATE_PILL = "Private";
export const TEAM_ACCOUNTS_NO_MEMBERS = "No team members were found.";

/** The one line on Getting started that shows a person their own Outlook state. */
export const YOUR_SETUP_LABEL = "Your setup";

// Weekly review (Nov 17): the Sent line on every card and the person lanes.
export const SENT_COULDNT_LOAD = "Sent: couldn't load";
export const SENT_NOTHING_YET = "Nothing sent yet";
export const SENT_ON = (date: string, kind?: string) => `Sent ${date}${kind ? ` · ${kind}` : ""}`;
export const SENT_KIND_EMAIL = "email";
export const SENT_KIND_CALL = "call";
export const LANE_OVERDUE = (n: number) => `${n} overdue`;
export const LANE_DUE_THIS_WEEK = (n: number) => `${n} due this week`;
export const LANE_WAITING_ON_CLIENT = "Waiting on client";
export const LANE_NOTHING_FOR_US = "Nothing for us to do here.";
export const LANE_NOBODY_WAITING = "Nobody is waiting on a client.";
/** What the number beside a person's name counts. */
export const LANE_COUNT_NOTE = "Cards in this column: our turn plus waiting on client";

// Weekly review: a record opens in the centred record card (no drawer). The review's own facts and actions sit in the card.
export const REVIEW_CARD_HEADING = "On the weekly review";
export const REVIEW_CARD_NOT_ON_REVIEW = "This record isn't on the weekly review right now.";
export const reviewCardStageDays = (n: number) => `${n}d in stage`;
export const REVIEW_CARD_USPTO_DEADLINE = "USPTO deadline";
/** The Cards deck's "Add to timeline" note box. */
export const REVIEW_LOG_LABEL = "What happened";
export const REVIEW_LOG_PLACEHOLDER = "A short note for the timeline";

// PGE Sprint 3 Part A: deadline safety.
/** The tag on a filed trademark with no open docket entry (matter page, Matters list, Weekly review). Never moves a row. */
export const NO_OPEN_DEADLINE = "No open deadline";
export const NO_OPEN_DEADLINE_HINT = "This trademark is filed and nothing is open on its docket. Add the next USPTO deadline, or close the matter if the work is done.";
/** The same flag on a REGISTERED mark (Taylor, Nov 23): no Section 8 or renewal deadline open. */
export const NO_MAINTENANCE_DEADLINE_HINT = "This trademark is registered and no Section 8 or renewal deadline is open on its docket. Add the next maintenance deadline, or close the matter if the work is done.";
/** A failed deadlines read: nothing is flagged, and this is said instead. */
export const DEADLINES_COULDNT_LOAD = "Deadlines couldn't load. Refresh to try again.";
export const DEADLINE_FLAGS_UNCHECKED = "Deadlines couldn't load, so filed and registered matters weren't checked for a missing deadline. Refresh to try again.";
/** The Today "Deadlines" card, drawn for the members chosen in Settings. */
export const DEADLINE_CARD_HEADING = "Deadlines";
export const DEADLINE_CARD_OVERDUE = "Overdue";
export const DEADLINE_CARD_WEEK = "Due in the next 7 days";
export const DEADLINE_CARD_MONTH = "Due in 8 to 30 days";
export const DEADLINE_CARD_NONE = "No open deadlines in the next 30 days.";
export const DEADLINE_CARD_FAILED = "Couldn't load";
export const DEADLINE_UNCONFIRMED = "Unconfirmed";
export const DEADLINE_ALERTS_UNCHECKED = "Deadline alerts couldn't be checked. Refresh to try again.";
export const deadlineCardMore = (n: number) => `and ${n} more`;
/** A Deadlines card read reached its cap: said, never silent. */
export const DEADLINE_CARD_CUT = "Not every deadline could be listed here.";
export const DEADLINE_CARD_OPEN_CALENDAR = "Open the calendar";
/** The bell notice when a deadline enters the 30- or 7-day window. Ids and the deadline's title only. */
export const DEADLINE_NOTICE_LABEL = "Deadline";
export const deadlineNoticeSentence = (window: number, title: string | null) => `${title ?? "A deadline"} is due within ${window} days`;
/** Settings -> Team: who gets the alerts. */
export const DEADLINE_ALERTS_SETTINGS_HEADING = "Deadline alerts";
export const DEADLINE_ALERTS_SETTINGS_HELP = "The people chosen here see the Deadlines card on Today and get a notice in the bell when a deadline is 30 days out and again at 7 days. Everyone still sees deadlines on the matter page.";
export const DEADLINE_ALERTS_NONE_CHOSEN = "Nobody is chosen yet, so nobody gets deadline alerts.";
export const DEADLINE_ALERTS_INELIGIBLE = "Viewers and social media members can\u2019t get deadline alerts. Pick someone else.";
export const DEADLINE_ALERTS_SAVE = "Save alert recipients";
/** The Weekly review's deadlines strip. */
export const REVIEW_DEADLINES_HEADING = "Deadlines";
export const REVIEW_DEADLINES_NONE = "No open deadlines in this view.";
export const REVIEW_DEADLINE_CONFIRMED = "Confirmed";
/** Closing a matter that still has an open deadline (an attorney, with a reason). */
export const CLOSE_OVERRIDE_SUMMARY = "Close with an open deadline";
export const CLOSE_OVERRIDE_HELP = "This matter has an open deadline. An attorney can still close it with a reason. The reason goes on the timeline.";
export const CLOSE_OVERRIDE_REASON = "Reason (required, up to 300 characters)";
export const CLOSE_OVERRIDE_CONFIRM = "I understand this matter will close with that deadline still open.";
export const CLOSE_OVERRIDE_BUTTON = "Close the matter";
export const CLOSE_OVERRIDE_DONE = "Closed. The reason is on the timeline.";
/** The pre-0110 override closed the matter, could not write its reason, and could not put the status back either. */
export const CLOSE_OVERRIDE_UNRECORDED = "The matter was closed, but the reason couldn't be recorded. Tell Lectual.";

/* ── The List's spreadsheet columns (Sprint 1): one registry, `src/lib/review/sheet-columns.ts` ── */
export const COL_TRADEMARK_OWNER = "Trademark Owner";
export const COL_TRADEMARK_NAME = "Trademark Name";
export const COL_SERIAL = "Serial No.";
export const COL_STATUS = "Status";
export const COL_SOURCE = "Source";
export const COL_NOTES = "Notes";
export const COL_START = "Start Date";
export const COL_LEGAL_FEE = "Legal Fee";
export const COL_LEGAL_FEE_DUE = "Legal Fee Due Date";
export const COL_GOV_FEE = "Government Filing fee";
export const COL_GOV_FEE_DUE = "Government Filing Fee Due Date";
export const COL_OA_DUE = "Office Action Due Date";
export const COL_WAITING = "Waiting on";
export const COL_CLIENT_NAME = "Client Name";
export const COL_PRACTICE_AREA = "Practice Area";
export const COL_CONTRACT_TYPE = "Contract Type";
/** Header titles (hover text): where Lectual's word and the spreadsheet's word differ, or the value needs a sentence. */
export const COL_OWNER_TITLE = "Assigned To in your spreadsheet: the next step's person, else the record's";
export const COL_NEXT_TITLE = "Task in your spreadsheet";
export const COL_START_TITLE = "The day it was opened in Lectual. Records brought in from the spreadsheet or Lawmatics show the day they were brought in.";
export const COL_CONTRACT_TYPE_TITLE = "The matter's title in Lectual.";
/** "Not tracked" names, one per spreadsheet column Lectual has no home for. */
export const NT_PRIORITY = "Priority";
export const NT_OPINION_LETTER_DUE = "Opinion Letter Due Date";
export const NT_COMPLETION_DATE = "Completion Date";
export const NT_OFFICE_ACTION_FEE = "Office Action Fee";
export const notTrackedNote = (names: readonly string[]) => `Not tracked in Lectual yet: ${names.join(", ")}.`;
/** Said only where a Notes column is drawn; without one it would point at nothing. */
export const NOT_TRACKED_NOTES_SENTENCE = "Description and Notes are one column in Lectual: Notes.";
export const COL_COULDNT_LOAD = "Couldn't load";
export const COL_UNCONFIRMED_SUFFIX = " · unconfirmed";
export const proposalsCount = (n: number) => `${n} proposals`;
export const FEE_FROM_PROPOSAL = "From the accepted proposal";
export const FEE_FROM_SPREADSHEET = "From the spreadsheet import";
/** The column chooser (draw-only, kept in this browser). */
export const COLUMNS_BUTTON = "Columns";
export const COLUMNS_MENU_LABEL = "Choose columns";
export const COLUMNS_RESET = "Reset to the spreadsheet's order";
export const COLUMNS_MOVE_UP = "Move up";
export const COLUMNS_MOVE_DOWN = "Move down";
export const COLUMNS_ALWAYS_SHOWN = "Always shown";
export const COLUMNS_KEPT_HERE = "Kept in this browser only. It changes what you see, not what you may see.";
export const columnsShow = (header: string) => `Show ${header}`;
export const columnsMoveUp = (header: string) => `${COLUMNS_MOVE_UP}: ${header}`;
export const columnsMoveDown = (header: string) => `${COLUMNS_MOVE_DOWN}: ${header}`;
export const columnsSectionLabel = (section: string) => `${section} columns`;
/** Firm-defined custom columns (lectual 0115, proposed). Read only until Settings -> Columns exists. */
export const CUSTOM_COLUMNS_NOT_ON = "Custom columns aren't switched on for your firm yet.";
export const CUSTOM_FROM_LEAD = "From the lead";
export const CUSTOM_FROM_MERGED = "From a merged duplicate";
export const CUSTOM_NO_LONGER_ON_TEAM = "Someone no longer on the team";
export const FIRM_COLUMNS_HEADING = "Firm columns";
/** The five kinds of custom column, as the chooser and a header's hover text name them. */
export const CUSTOM_KIND_TEXT = "Text";
export const CUSTOM_KIND_DATE = "Date";
export const CUSTOM_KIND_MONEY = "Money";
export const CUSTOM_KIND_CHOICE = "Choice";
export const CUSTOM_KIND_PERSON = "Person";

/* ── Settings -> Columns and the custom-column writes (Sprint 3; lectual 0115, proposed) ── */
export const COLUMNS_SETTINGS_NAME = "Columns";
export const COLUMNS_SETTINGS_SUB =
  "Your firm's own columns on the Weekly review List. Everyone in the firm sees them, money columns included. A column's kind and section can't change after it's added. Archiving a column keeps its values.";
export const columnsCount = (n: number) => `${n} of 40 columns`;
export const COLUMNS_ADD = "Add a column";
export const COLUMNS_NAME_LABEL = "Name";
export const COLUMNS_SECTION_LABEL = "Section";
export const COLUMNS_KIND_LABEL = "Kind";
export const COLUMNS_CHOICES_LABEL = "Choices (one per line)";
export const COLUMNS_CHOICES_HINT = "Only for a Choice column";
/** The List's two sections, and a column that shows in both. */
export const CUSTOM_SECTION_WORDS = { trademarks: "Trademarks", contracts: "Contracts", both: "Both" } as const;
export const archiveQuestion = (label: string) => `Archive ${label}? It leaves the List; its values are kept.`;
export const archivedHeading = (n: number) => `Archived columns (${n})`;
/** Settings -> Columns lists the first `n` archived columns; there are more (never an error page). */
export const archivedShownNote = (n: number) => `Showing the first ${n} archived columns.`;
export const COLUMNS_ARCHIVE = "Archive";
export const COLUMNS_RESTORE = "Restore";
export const COLUMNS_RENAME = "Rename";
export const COLUMNS_EDIT_CHOICES = "Edit choices";
export const COLUMNS_SAVE_NAME = "Save name";
export const COLUMNS_SAVE_CHOICES = "Save choices";
export const columnsRenameLabel = (label: string) => `New name for ${label}`;
export const columnsChoicesFor = (label: string) => `Choices for ${label}, one per line`;
export const columnsRestoreLabel = (label: string) => `Restore ${label}`;
export const columnsArchiveLabel = (label: string) => `Archive ${label}`;
export const COLUMNS_AT_LIMIT = "Your firm has 40 columns, the most it can have. Archive one to add another.";
export const COLUMNS_NONE = "No columns yet. Add one below.";
export const choiceUse = (option: string, n: number) => `${option}: used on ${n} ${n === 1 ? "record" : "records"}`;
export const COLUMNS_USE_UNCOUNTED = "Couldn't count which choices are in use. Saving still checks.";
/** The field actions' gate: an owner's membership row (lectual 0119 makes field create and change owner-only). */
export const COLUMNS_NO_PERMISSION = "Only an owner can change columns.";

/** The fixed sentences the custom-column actions and the error mapper answer with. Never any part of a database message. */
export const CUSTOM_COLUMNS_NOT_READY = `${CUSTOM_COLUMNS_NOT_ON} Lectual will turn it on.`;
export const CUSTOM_FIELD_IMMUTABLE = "A column's kind and where it shows can't be changed after it's added.";
export const CUSTOM_LIMIT = "Your firm is at its limit of 40. Archive a column first.";
export const CUSTOM_LABEL_TAKEN = "That name is in use by one of your firm's columns. Pick a different name.";
export const CUSTOM_OPTIONS_IN_USE = "One of the choices you took out is still used on a record. Keep it, or change those records first.";
export const CUSTOM_VALUE_IMMUTABLE = "A saved value stays with the column and the lead or matter it was saved on. Clear it, then type the new one.";
export const CUSTOM_VALUE_ONE_RECORD = "Each saved value is for a single record.";
export const CUSTOM_FIELD_GONE = "That column couldn't be found. It may have been archived or removed.";
export const CUSTOM_VALUE_MERGED = "That lead is now part of another lead. Change the value there.";
export const CUSTOM_COLUMN_ARCHIVED = "Archived columns can't be changed.";
export const CUSTOM_WRONG_SECTION = "Wrong part of the List for that column.";
export const CUSTOM_VALUE_EMPTY = "Clear the cell to remove a value.";
export const CUSTOM_WRONG_KIND = "That entry isn't the right type for this column.";
export const CUSTOM_CHOICE_BAD = "Pick a choice from the list.";
export const CUSTOM_LABEL_TOO_LONG = "Names can be up to 60 characters.";
export const CUSTOM_LABEL_SPACES = "Take the spaces off the start and end of the name.";
export const CUSTOM_CHOICES_INVALID = "Choices need 1 to 30 different entries of up to 40 characters each.";
export const CUSTOM_BAD_SECTION = "Choose Trademarks, Contracts or Both.";
export const CUSTOM_BAD_KIND = "Choose Text, Date, Money, Choice or Person.";
export const CUSTOM_MOVE_FAILED = "The order couldn't be saved. Refresh and try again.";
export const CUSTOM_TEXT_TOO_LONG = "Text can be up to 500 characters.";
export const CUSTOM_MONEY_TOO_BIG = "That amount is too large.";
export const CUSTOM_PERSON_NOT_MEMBER = "Choose someone on your firm's team.";
export const CUSTOM_VALUE_CHANGED = "This cell was changed by someone else just now. Refresh and try again.";
export const CUSTOM_VALUE_NOT_ALLOWED = "Your role can't change this value. Ask an attorney or an admin.";
/** A firm's own Money column is owner-only, like the fee columns (Taylor, Nov 23): the refusal for anyone else's write. */
export const CUSTOM_MONEY_OWNER_ONLY = "Only the firm's owner can see or change money in the firm's own columns.";
/** Settings -> Columns, under the kind select. */
export const COLUMNS_KIND_MONEY_HINT = "Money columns are shown only to the firm's owner, like the fee columns.";
export const CUSTOM_BUSY = "Someone else was changing this column at the same moment. Try again.";
export const CUSTOM_SAVE_FAILED = "The column couldn't be saved. Try again.";
export const CUSTOM_VALUE_SAVE_FAILED = "The value couldn't be saved. Try again.";
export const CUSTOM_FIELD_CHANGED = "This column was changed by someone else just now. Refresh and try again.";
export const CUSTOM_ORDER_CHANGED = "The order changed while you were looking. Refresh and try again.";
export const CUSTOM_SAVE_FAILED_READ = "Couldn't check the firm's columns just now, so nothing was saved. Try again.";
export const CUSTOM_LABEL_EMPTY = "Give the column a name.";
export const CUSTOM_CHOICES_COUNT = "A Choice column needs 1 to 30 choices.";
export const CUSTOM_CHOICE_TOO_LONG = "Choices can be up to 40 characters.";
export const choiceRepeated = (choice: string) => `${choice} is listed twice. Each choice must be different.`;
export const labelIsBuiltin = (label: string) => `${label} is already a column on the List. Choose another name.`;
export const labelTaken = (label: string) => `${label} is already one of your firm's columns. Choose another name.`;
export const optionInUse = (option: string, n: number) => `${option} is still used on ${n} ${n === 1 ? "record" : "records"}.`;
export const CUSTOM_DATE_BAD = "Choose a date.";
export const CUSTOM_MONEY_BAD = "Enter an amount like 1,250 or 1250.00.";
export const CUSTOM_TEAM_UNREADABLE = "Couldn't check the team list right now, so nothing was saved. Try again.";

/** The custom-cell editors (owner Sheet and the opened card). */
export const fromLeadHint = (text: string) => `${CUSTOM_FROM_LEAD}: ${text}`;
export const fromMergedHint = (text: string) => `${CUSTOM_FROM_MERGED}: ${text}`;
export const noLongerAChoice = (value: string) => `${value} (no longer a choice)`;
export const CUSTOM_NO_ONE = "No one";
export const CUSTOM_FROM_LEAD_KEPT = "Cleared. The lead's value still shows here.";
export const CUSTOM_FROM_MERGED_KEPT = "Cleared. The merged duplicate's value still shows here.";
export const customCellLabel = (label: string, value: string) => `${label}: ${value}`;
/* Getting started: the short guide for staff roles (every role outside the admin tier). */
export const STAFF_GUIDE_TRACK = "Your first steps";
export const STAFF_GUIDE_TRACK_SUMMARY = "Your name, your own mailbox and a short tour.";
export const STAFF_GUIDE_NAME_TITLE = "Add your name";
export const STAFF_GUIDE_NAME_SUMMARY = "So your team sees who you are.";
export const STAFF_GUIDE_NAME_STEP = "Your name";
export const STAFF_GUIDE_NAME_BODY = "Open this menu and choose Your name. It's how your team sees you in Lectual.";
export const STAFF_GUIDE_MAILBOX_TITLE = "Connect your Outlook";
export const STAFF_GUIDE_MAILBOX_SUMMARY = "Your own mailbox, so your mail shows on your leads and matters.";
export const STAFF_GUIDE_MAILBOX_BODY = "Choose Connect Outlook at the top of this page to connect your own mailbox. A personal mailbox is yours: colleagues don't see it here.";
export const STAFF_GUIDE_TOUR_TITLE = "Take the tour";
export const STAFF_GUIDE_TOUR_SUMMARY = "A quick look at the main screens.";
export const STAFF_GUIDE_TOUR_BODY = "Choose Show tips again in this menu for a short tour of the main screens. You can take it as often as you like.";

// Team settings: touching an owner row (mirrors the lectual 0116 proposal's rule).
/** Refused when the caller has no OWNER membership row in this firm (a Lectual staff member's owner claim alone is not enough). */
export const OWNER_ROW_NEEDS_OWNER = "Only an owner of this firm can change or remove an owner.";
/** Refused when the caller's own membership row couldn't be read: nothing was changed and nobody was signed out. */
export const OWNER_ROW_CHECK_FAILED = "Couldn't confirm you're an owner of this firm, so nothing was changed. Refresh and try again.";

// Lawmatics daily sync (new prospects and booked consults). Counts only; never a name, email, title or link.
export const LAWMATICS_SYNC_NOW = "Sync from Lawmatics now";
export const LAWMATICS_SYNC_READING = "Reading Lawmatics…";
export const LAWMATICS_SYNC_HELP =
  "Three times a day Lectual reads your Lawmatics: new enquiries become leads, booked consults go on the calendar, and people marked Hired get a matter (early morning only). This button does it now for your firm. It only reads from Lawmatics and never moves a lead's stage.";
export const LAWMATICS_SYNC_NOT_ALLOWED = (who: string) => `${who} can sync from Lawmatics.`;
export const LAWMATICS_SYNC_SIGN_IN = "Sign in again to sync from Lawmatics.";
export const LAWMATICS_SYNC_REAUTH = "Lawmatics no longer accepts your firm's key. Reconnect it above.";
export const LAWMATICS_SYNC_OUT_OF_TIME = "Lawmatics took too long. Try again shortly.";
export const LAWMATICS_SYNC_NOT_CONNECTED = "Lawmatics isn't connected for your firm.";
export const LAWMATICS_SYNC_FAILED = "We couldn't sync from Lawmatics just now. Try again shortly.";
export const LAWMATICS_SYNC_KEY_UNREADABLE = "We couldn't open your firm's Lawmatics key, so nothing was synced. Reconnect it above, or try again shortly.";
/** A step that couldn't read Lawmatics: named by what it does, never with raw text. */
export const LAWMATICS_SYNC_STEP_NAMES = { hired: "hired matters", prospects: "new leads", consults: "consults" } as const;
export const lawmaticsSyncStepsFailed = (steps: readonly string[]) =>
  `We couldn't read Lawmatics for ${steps.join(" and ")}, so nothing was changed there. Try again shortly.`;
const lmCount = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "Added 3 leads, linked 1, 1 came back, 2 need a look. 4 consults updated, 1 removed. Added 0 matters, linked 0." */
export function lawmaticsSyncResult(s: {
  leadsAdded: number;
  leadsLinked: number;
  cameBack: number;
  needALook: number;
  consultsUpdated: number;
  consultsRemoved: number;
  mattersAdded: number | null;
  mattersLinked: number | null;
  waiting: number;
}): string {
  const parts = [
    `Added ${lmCount(s.leadsAdded, "lead", "leads")}, linked ${s.leadsLinked}, ${s.cameBack} came back, ${s.needALook} need a look.`,
    `${lmCount(s.consultsUpdated, "consult", "consults")} updated, ${s.consultsRemoved} removed.`,
  ];
  if (s.mattersAdded !== null) parts.push(`Added ${lmCount(s.mattersAdded, "matter", "matters")}, linked ${s.mattersLinked ?? 0}.`);
  if (s.waiting > 0) parts.push(`${s.waiting} more wait for the next run.`);
  return parts.join(" ");
}
/** Fixed sentence stored as `lawmatics_connection.last_error` when Lawmatics refuses the firm's key during the sync. */
export const LAWMATICS_SYNC_KEY_REFUSED = "Lawmatics stopped accepting your firm's token during the daily sync.";
export const LAWMATICS_LAST_SYNC_NOT_READY = notReadyYet("Showing the last daily sync");
export const lawmaticsLastSync = (when: string | null) => (when ? `Last complete daily sync ${when}.` : "The daily sync hasn't finished a complete run yet.");

/** "Came back": a Lost, Won or Nurture lead who made a new enquiry in Lawmatics. Ids only on the timeline row. */
export const CAME_BACK_LABEL = "Came back";
export const CAME_BACK_UNAVAILABLE = "Can't show returning clients right now. Refresh to try again.";
export type CameBackCategory = "won" | "lost" | "nurture";
export function cameBackLine(name: string, category: CameBackCategory): string {
  if (category === "won") return `${name} is an existing client with a new enquiry in Lawmatics (possibly a new trademark).`;
  if (category === "lost") return `${name} came back with a new enquiry in Lawmatics. They were marked Lost.`;
  return `${name} came back with a new enquiry in Lawmatics. They were in Nurture.`;
}
export const CAME_BACK_TIMELINE = "Came back: new enquiry in Lawmatics";
export const CAME_BACK_OPEN = "Open lead";

/** Consults from Lawmatics on Today, the lead page and the calendar. */
export const LAWMATICS_CONSULTS_NOT_CONNECTED = "Consults from Lawmatics aren't shown: Lawmatics isn't connected.";
export const LAWMATICS_CONSULTS_UNAVAILABLE = "Lawmatics consults couldn't be read just now.";
export const LAWMATICS_CONSULTS_RECONNECT = "Lawmatics no longer accepts your firm's key, so new consults won't come over until you reconnect.";
export const LAWMATICS_CONSULTS_NOT_READY = notReadyYet("Consults from Lawmatics");
/** Stage suggestion reason for a consult booked in Lawmatics (it may have been booked by the client). */
export const WHY_LAWMATICS_CONSULT = "This consult was booked in Lawmatics, possibly by the client, so a person decides.";

/** View as (an owner's read-only look at a teammate's view). Spec docs/pge/2026-11-17-agentic-ip-os/spec-owner-view-as.md. */
export const VIEW_AS_BANNER = (name: string) => `Viewing as ${name} (read-only)`;
/** The phone banner: one short line. */
export const VIEW_AS_BANNER_SHORT = (name: string) => `Viewing as ${name} · read-only`;
export const VIEW_AS_EXIT = "Exit";
export const VIEW_AS_READ_ONLY = "This is a read-only preview. Nothing was changed.";
export const VIEW_AS_EXIT_FAILED = "Couldn't leave the preview. Try again, or sign out to end it.";
export const VIEW_AS_PRIVATE_MAIL = (name: string) => `${name}'s own mailbox is private to them and isn't shown in a preview.`;
/** A preview whose teammate couldn't be named: personal mailboxes are left out all the same. */
export const VIEW_AS_PERSONAL_HIDDEN = "Personal mailboxes aren't shown in a preview.";
export const VIEW_AS_LIVE_MAIL = "Live mail isn't read in a preview. Stored messages are shown.";
export const VIEW_AS_PRIVATE_OUTLOOK = (name: string) => `${name}'s own Outlook isn't checked in a preview.`;
export const VIEW_AS_PRIVATE_COPILOT = (name: string) => `${name}'s Copilot chats are private to them and aren't shown in a preview.`;
export const VIEW_AS_PRIVATE_BELL = (name: string) => `${name}'s notifications are private to them and aren't shown in a preview.`;
/** A preview whose teammate couldn't be named (the state couldn't be checked, or the team list couldn't be read). */
export const VIEW_AS_OUTLOOK_UNCHECKED = "Outlook calendars aren't checked in a preview.";
export const VIEW_AS_ZOOM = "Zoom consults aren't read in a preview.";
export const VIEW_AS_NOT_ALLOWED = "Only an owner of this firm can view the app as a teammate.";
export const VIEW_AS_TARGET_GONE = "That person isn't on your team any more.";
export const VIEW_AS_UNCHECKED = "Couldn't check whether you're viewing as a teammate. Nothing can be changed until you refresh.";
export const VIEW_AS_LINK = "View as";
export const VIEW_AS_MENU = "View as a teammate";
export const VIEW_AS_MENU_HEADER = (name: string) => `Viewing as ${name}`;
export const VIEW_AS_NOT_READY = notReadyYet("Viewing as a teammate");
/** Enter failed for a reason that is not one of the above (a read or write that didn't go through). */
export const VIEW_AS_START_FAILED = "Couldn't start the preview. Try again.";
/** The target's row could not be read from the team list while previewing. */
export const VIEW_AS_TEAM_UNREADABLE = "Couldn't load your team. Refresh to try again.";
/** A hint cookie left behind by a preview that has already ended (closed by the database, or View as not switched on). */
export const VIEW_AS_STALE = "Your earlier preview has ended.";
export const VIEW_AS_LEAVE = "Leave preview";
// Consult prep (auto): the lead page's card, Settings -> Team's recipients, the timeline lines.
export const CONSULT_PREP_HEADING = "Consult prep";
export const CONSULT_PREP_NOT_YET = "Not prepared yet: it runs when the lead is in Consultation Scheduled.";
export const CONSULT_PREP_OFF = "Prep is off for your firm.";
export const CONSULT_PREP_NO_RECIPIENTS = "No one is set to receive consult prep.";
export const CONSULT_PREP_SET_IN_TEAM = "Set it in Settings → Team.";
export const CONSULT_PREP_ASK_ADMIN = "An owner or admin can set it in Settings → Team.";
export const CONSULT_PREP_COULDNT_LOAD = "Couldn't load consult prep. Refresh to try again.";
export const CONSULT_PREP_EMAIL_OFF = "Email isn't switched on for your firm yet. Lectual will turn it on.";
export const CONSULT_PREP_NOT_EMAILED = "not emailed";
export const CONSULT_PREP_RECIPIENTS_NOW = "Emails now go to the people set in Settings → Team";
export const CONSULT_PREP_RECIPIENTS_UNREAD = "Who gets consult prep couldn't be read.";
export const CONSULT_PREP_VIEW_BRIEF = "View the brief";
export const CONSULT_PREP_BRIEF_NOT_KEPT = "The brief isn't kept in Lectual because approvals aren't connected for your firm. It was emailed to your team.";
export const CONSULT_PREP_BRIEF_UNAVAILABLE = "The brief couldn't be loaded. Refresh to try again.";
export const CONSULT_PREP_BRIEF_MISSING = "The brief is no longer in Approvals.";
export const CONSULT_PREP_RERUN = "Re-run prep";
export const CONSULT_PREP_RERUN_CONFIRM = "Re-run prep? It prepares this consult again and emails a new brief to your team. Reminders already scheduled are not repeated.";
export const CONSULT_PREP_RERUN_RUNNING = "Preparing…";
export const CONSULT_PREP_RERUN_DONE = "Prep re-run. Refresh to see it.";
export const CONSULT_PREP_RERUN_NOT_ALLOWED = "Only an owner, admin or attorney can re-run consult prep.";
export const CONSULT_PREP_RERUN_OFF = "Consult prep isn't switched on for your firm, so it wasn't re-run.";
export const CONSULT_PREP_RERUN_NOTHING = "There is no consult to prepare for this lead yet.";
export const CONSULT_PREP_RERUN_FAILED = "Couldn't re-run prep. Nothing was changed. Try again in a minute.";
export const CONSULT_PREP_TIMELINE_PREP = "Consult prep made";
export const consultPrepTimelineSend = (kind: "booked" | "24h" | "1h", status: "sent" | "scheduled" | "cancelled" | "failed" | "duplicate"): string => {
  const what = kind === "booked" ? "Consult prep email" : kind === "24h" ? "Consult prep reminder, a day before" : "Consult prep reminder, an hour before";
  return `${what}: ${status === "failed" ? "couldn't be sent" : status === "duplicate" ? "already sent by another run" : status}`;
};
export const CONSULT_PREP_TEAM_HEADING = "Consult prep emails";
export const CONSULT_PREP_TEAM_HELP = "When a consult is prepared, the brief is emailed to the people chosen here when it is booked, a day before (if it was booked more than a day ahead) and an hour before. It goes only to the firm, never to a client. Cc addresses must be on the same email domain as someone chosen.";
export const CONSULT_PREP_TEAM_NONE = "Nobody is chosen yet, so no consult prep emails go out.";
export const CONSULT_PREP_TEAM_UNCHECKED = "Consult prep emails couldn't be checked. Refresh to try again.";
export const CONSULT_PREP_TEAM_SAVE = "Save consult prep emails";
export const CONSULT_PREP_TEAM_CC_LABEL = "Cc (optional, up to 5 addresses)";
export const CONSULT_PREP_TEAM_INELIGIBLE = "Viewers and social media members can’t get consult prep. Pick someone else.";
export const CONSULT_PREP_TEAM_CC_FORMAT = "Each Cc must be a plain email address, like info@yourfirm.com.";
export const CONSULT_PREP_TEAM_CC_DOMAIN = "A Cc address must be on the same email domain as someone chosen above.";
export const CONSULT_PREP_TEAM_CC_COUNT = "You can add up to 5 Cc addresses.";

/** A List or Board's saved column layout couldn't be read: the standard columns are drawn and this is said once. */
export const VIEW_LAYOUT_UNAVAILABLE = "Saved column layout couldn't load. Showing the standard columns. Refresh to try again.";

/* ── Changing a view's columns (the owner's header menu; every sentence is fixed, never database text) ── */
export const LAYOUT_OWNER_ONLY = "Only an owner can change this view.";
export const LAYOUT_CHANGED = "Someone else changed this view. Refresh to see their change.";
export const LAYOUT_NOT_READY = notReadyYet("Changing columns");
export const LAYOUT_SAVE_FAILED = "Couldn't change this view. Nothing was changed. Try again.";
export const LAYOUT_READ_FAILED = "Couldn't read this view's saved columns, so nothing was changed. Refresh to try again.";
export const LAYOUT_COLUMN_GONE = "That column isn't in this view any more. Refresh to see the current columns.";
export const LAYOUT_COLUMN_PINNED = "This column stays where it is and always shows.";
export const LAYOUT_LAST_COLUMN = "A view needs at least one column showing.";
export const LAYOUT_TOO_MANY = "A view can have up to 80 columns.";
export const LAYOUT_COLUMN_TAKEN = "That column is already in this view.";
export const LAYOUT_NAME_EMPTY = "Type a name for the column.";
export const LAYOUT_NAME_TOO_LONG = "A column name can be up to 60 characters.";
export const LAYOUT_NAME_CHARACTERS = "A column name can't have tabs, line breaks or hidden characters.";
export const LAYOUT_CANT_MOVE = "It can't move any further that way.";
export const LAYOUT_BAD_WIDTH = "That width isn't valid.";
export const LAYOUT_PLACE_NOT_SAVED = "The column was added, but its place in the view couldn't be saved. It is at the end for now.";
export const LAYOUT_SAVED_NOTE = "Saved for everyone in the firm.";
export const columnMenuLabel = (name: string) => `Column options: ${name}`;
export const COLUMN_MENU_HIDE = "Hide column";
export const COLUMN_MENU_LEFT = "Move left";
export const COLUMN_MENU_RIGHT = "Move right";
export const COLUMN_MENU_ADD_LEFT = "Add a column to the left";
export const COLUMN_MENU_ADD_RIGHT = "Add a column to the right";
export const COLUMN_MENU_SAVE = "Save";
export const COLUMN_NEW_NAME_LABEL = "Column name";
export const COLUMN_ADD_SUBMIT = "Add column";
export const COLUMN_CHANGES_NOTE = "A change here is the firm's view for everyone.";
export const HIDDEN_COLUMNS_NAME = "Hidden columns";
export const hiddenColumnsLabel = (n: number) => `Hidden columns (${n})`;
export const HIDDEN_COLUMNS_NONE = "No hidden columns.";
export const HIDDEN_COLUMN_SHOW = "Show";
export const hiddenColumnShowLabel = (name: string) => `Show ${name}`;
export const laneMenuLabel = (name: string) => `Column options for ${name}`;

/* ── Add a real lead or matter from the bottom of the Weekly review List ── */
export const ADD_ROW_LEAD_HINT = "Adds a real lead in your new-enquiry stage. It shows in this list once it's added.";
export const ADD_ROW_FIRST_NAME = "First name";
export const ADD_ROW_LAST_NAME = "Last name";
export const ADD_ROW_EMAIL = "Email (optional)";
export const ADD_ROW_BUSINESS = "Business (optional)";
export const ADD_ROW_SUBMIT = "Add lead";
export const ADD_ROW_OPEN_MATTER = "Open a matter";
export const ADD_ROW_ADDED = "Lead added.";
export const ADD_ROW_NO_PERMISSION = "You don't have permission to add leads. Ask an attorney or an admin.";
export const ADD_ROW_FAILED = "Couldn't add this lead. Nothing was added. Try again.";

/**
 * The firm's Board layout hides some columns: said once above the Board, with a link to the List where those records still show.
 * Unassigned is counted apart from people ("Unassigned and 2 people's columns are hidden in this firm's layout.").
 */
export const boardLanesHidden = (people: number, unassigned: boolean): string => {
  const person = people === 1 ? "1 person's column" : `${people} people's columns`;
  if (people > 0 && unassigned) return `Unassigned and ${person} are hidden in this firm's layout.`;
  if (unassigned) return "The Unassigned column is hidden in this firm's layout.";
  return `${person} ${people === 1 ? "is" : "are"} hidden in this firm's layout.`;
};
export const BOARD_LANES_HIDDEN_LINK = "See them in the List";
