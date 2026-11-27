import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import { DOCUMENT_QUEUE_TYPES } from "@/lib/documents/types";
import { SEND_BACK_NOTE_MAX, sendBackNoteTooLong } from "@/lib/queue/handed";
import { isDoneNote } from "@/lib/queue/done";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { approvalRefusal, memberName } from "@/lib/queue/routing";
import type { ReviewInput, ReviewOutcome } from "@/lib/queue/review-core";
import {
  LEAD_STEP_ALREADY_DECIDED,
  LEAD_STEP_APPROVED_DRAFT_FAILED,
  LEAD_STEP_APPROVED_MANUAL,
  LEAD_STEP_APPROVED_NO_DRAFT,
  LEAD_STEP_APPROVED,
  LEAD_PAGE_STALE_DRAFT,
  LEAD_STEP_APPROVED_LETTER,
  LEAD_STEP_HANDED_AWAY,
  LEAD_STEP_LINK_NOT_LIVE,
  LEAD_STEP_SENT_BACK,
  LEAD_STEP_CANT_CHECK,
  LEAD_STEP_CLOSER_LOOK,
  LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX,
  LEAD_STEP_DROPPED,
  LEAD_STEP_EDIT_EMPTY,
  LEAD_STEP_EDIT_SAVED,
  LEAD_STEP_FAILED,
  LEAD_STEP_NOT_ON_LEAD,
  LEAD_STEP_NO_APPROVE,
  LEAD_STEP_NO_EDIT,
  LEAD_STEP_PREVIEW_ONLY,
  LEAD_STEP_REASON_NEEDED,
  REJECT_NOTE_IS_DONE_MARKER,
  DRAFT_CHANGED_REFRESH,
  SEND_BACK_NOTE_TOO_LONG,
  leadStepDraftInMailbox,
  PASS_FAILED,
  passedToDrafter,
  APPROVED_CLIENT_EMAIL_NO_DRAFT,
  APPROVED_DRAFT_CHECK_OUTLOOK,
  APPROVED_DRAFT_FAILED_OUTLOOK,
} from "@/lib/ui/words";
import type { HandoffFact, RoutingFacts } from "./facts";
import type { LeadCloserLook } from "./closer-look";

/**
 * Yes / Edit / Not this on the lead page's top card, with every dependency injected so the order of the checks is
 * tested without a database (tests/lead-step/actions.test.ts). `actions.ts` is the thin "use server" wiring.
 *
 * NOTHING NEW DECIDES WHO MAY APPROVE. Every write goes through the EXISTING core, `runQueueReview`
 * (`src/lib/queue/review-core.ts`): approve, reject and save, which re-resolves the role, re-reads the item, runs the
 * routing rule (`approvalRefusal` / `canApproveItem`, attorney-only kinds included), the linked-proposal gate, the
 * draft audit and the stale check, and never sends (a client email becomes a DRAFT). The checks here run FIRST and
 * only ever refuse more, never less:
 *
 *   1  ids are well formed (and for Not this, the reason is 1 to 200 characters after cleaning)
 *   2  Lectual staff viewing as the firm are refused (`staffPreviewRefusal`)
 *   3  the caller holds a staff role, re-resolved from the session (no role, user or org from the browser):
 *      refused BEFORE any read
 *   4  the item is re-read: it must still be pending and still belong to THIS lead (the queue's own resolver, across
 *      the lead's merged set)
 *   5  approve / reject: the routing rule for the item as re-read (an edit can have made it attorney-only)
 *   6  approve: a card the caller handed on to someone else is not theirs to approve here (the deck's hand-off,
 *      folded with the deck's trust rule; an unreadable hand-off state changes nothing, as on the deck)
 *   7  approve: the deck's closer-look rule (CHECK FIRST, draft issue, stale draft, linked-proposal gate) plus this
 *      page's own: a linked proposal that isn't live yet (the core would turn its link on). Any reason, or a check that
 *      couldn't run, refuses with a fixed sentence: the full approval page is where those are handled. The stale
 *      confirm is never passed from here.
 *   8  the existing core, which checks it all again
 *
 * Send back (a card handed to the caller) is the deck's own `sendCardBack`, after steps 1 to 4.
 * No database and no server-only import (tests/lead-step/hygiene.test.ts walks the import graph).
 *
 * After a Yes the sentence names only what the core REPORTS happened (`afterYesSentence`). It never assumes Outlook.
 */

export type ActionCaller = { userId: string; role: Role };

export type LeadStepActionDeps = {
  /** A fixed sentence when the caller is Lectual staff viewing as the firm, else null. */
  staffPreview: () => Promise<string | null>;
  /** The signed-in caller with a staff role (QUEUE_EDIT_ROLES), from the session; null otherwise. */
  caller: () => Promise<ActionCaller | null>;
  readItem: (id: string) => Promise<QueueItem | null>;
  /** The lead ids the queue's resolver links this item to; null when the lookup failed. */
  leadIdsOf: (item: QueueItem) => Promise<string[] | null>;
  /** The page's lead, followed to its keeper, and the leads merged into it; null when it couldn't be read. */
  leadSet: (leadId: string) => Promise<string[] | null>;
  routing: () => Promise<RoutingFacts>;
  /** The page's closer-look rule for this item (`leadCloserLook`); null when it couldn't be checked. */
  closerLook: (item: QueueItem) => Promise<LeadCloserLook | null>;
  /** Who holds the card (trusted hand-off events, as the deck folds them). */
  handoff: (item: QueueItem) => Promise<HandoffFact>;
  /** The deck's Send back (`sendCardBack`, which re-checks the caller, the item and the events itself). */
  sendBack: (id: string, note: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** The existing approve / reject / save core. */
  review: (input: ReviewInput) => Promise<ReviewOutcome>;
  revalidate: (leadId: string) => void;
};

export type YesResult = { ok: true; message: string; webLink: string | null; warn: boolean } | { ok: false; error: string; connect?: string | null };
export type NotThisResult = { ok: true; message: string } | { ok: false; error: string };
/** No "may say yes now" in the answer: the page is revalidated and recomputes it from the re-read item. */
export type EditResult = { ok: true; message: string } | { ok: false; error: string };
export type SendBackResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The same shape `src/lib/queue/shown-text.ts` checks (that file uses node:crypto, which this pure file can't import). */
const SHOWN_SHA256 = /^[0-9a-f]{64}$/;
/** The approve core asks for a ticked confirmation box on a stale draft; this page has none, so it says its own sentence. */
const STALE_CONFIRM = /confirmation box/i;
export const REASON_MAX = 200;
export const BODY_MAX = 20_000;

export function leadIdOf(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

export function itemIdOf(raw: unknown): string | null {
  return typeof raw === "string" && QUEUE_ID.test(raw) ? raw : null;
}

/**
 * The Not this reason: format characters (zero-width and bidi controls, \p{Cf}) are removed, control characters
 * become spaces, whitespace collapses, then 1 to 200 characters. Null otherwise.
 */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\p{Cf}/gu, "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length >= 1 && cleaned.length <= REASON_MAX ? cleaned : null;
}

/** An edited body: control characters other than line breaks and tabs removed; empty or too long is null. */
export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleaned.trim() && cleaned.length <= BODY_MAX ? cleaned : null;
}

/**
 * After a Yes, the sentence for what really happened, from the approve core's OWN result: which mailbox (if any) holds
 * the draft. `owner` names the person whose mailbox it is when it isn't the reader's; null reads "your".
 */
/**
 * True when the approval went through but nothing reached a mailbox (the draft failed, or none was made): the page shows
 * it as a warning with a link to the approval, never as a green success.
 */
export function afterYesWarns(outcome: Extract<ReviewOutcome, { kind: "resolved" }>, itemType: string): boolean {
  const send = outcome.send;
  // Sprint 4: passed to the firm's drafter is a success (no mailbox draft is expected); a failed pass is a warning.
  if (send === "passed") return false;
  if (send === "pass-failed") return true;
  if (send === "failed" || send === "mailbox-failed" || send === "mailbox-uncertain") return true;
  // A client email approved with no draft made: a warning, never "this type isn't emailed".
  if (send === "manual" && itemType === "CLIENT_EMAIL") return true;
  if (send === "mailbox-microsoft" || send === "mailbox-google" || send === "drafted" || send === "manual" || send === "sent") return false;
  return !DOCUMENT_QUEUE_TYPES.has(itemType);
}

export function afterYesSentence(outcome: Extract<ReviewOutcome, { kind: "resolved" }>, itemType: string, owner: string | null = null, drafterName: string | null = null): string {
  const send = outcome.send;
  // Sprint 4: the same sentences the deck and the full approval page say.
  if (send === "passed") return passedToDrafter(drafterName?.trim() || "the drafter");
  if (send === "pass-failed") return PASS_FAILED;
  if (send === "mailbox-microsoft" || send === "mailbox-google") {
    const provider = outcome.provider ?? (send === "mailbox-microsoft" ? "microsoft" : "google");
    return leadStepDraftInMailbox(owner, provider === "microsoft" ? "Outlook" : "Gmail");
  }
  if (send === "drafted") return LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX;
  if (send === "manual") return itemType === "CLIENT_EMAIL" ? APPROVED_CLIENT_EMAIL_NO_DRAFT : LEAD_STEP_APPROVED_MANUAL;
  // Approver drafts: the one draft in the approver's own Outlook failed for certain, or may have been made.
  if (send === "mailbox-failed") return APPROVED_DRAFT_FAILED_OUTLOOK;
  if (send === "mailbox-uncertain") return APPROVED_DRAFT_CHECK_OUTLOOK;
  if (send === "failed") return LEAD_STEP_APPROVED_DRAFT_FAILED;
  // The queue's own answer; the deck says the same.
  if (send === "sent") return LEAD_STEP_APPROVED;
  // A letter is not emailed: approving makes its document (the approve hook, best-effort; a failure shows on Documents).
  if (DOCUMENT_QUEUE_TYPES.has(itemType)) return LEAD_STEP_APPROVED_LETTER;
  return LEAD_STEP_APPROVED_NO_DRAFT;
}

type Checked = { ok: true; caller: ActionCaller; item: QueueItem; routing: RoutingFacts } | { ok: false; error: string };

/** Steps 2 to 4 (and the routing read), shared by the three actions. */
async function checkCallerAndItem(deps: LeadStepActionDeps, leadId: string, itemId: string, noRole: string): Promise<Checked> {
  const preview = await deps.staffPreview();
  if (preview) return { ok: false, error: LEAD_STEP_PREVIEW_ONLY };
  const caller = await deps.caller();
  if (!caller || !QUEUE_EDIT_ROLES.includes(caller.role)) return { ok: false, error: noRole };
  const item = await deps.readItem(itemId);
  if (!item) return { ok: false, error: LEAD_STEP_FAILED };
  if (item.status !== "pending") return { ok: false, error: LEAD_STEP_ALREADY_DECIDED };
  const [linked, set] = await Promise.all([deps.leadIdsOf(item), deps.leadSet(leadId)]);
  if (linked === null || set === null) return { ok: false, error: LEAD_STEP_FAILED };
  if (!linked.some((id) => set.includes(id))) return { ok: false, error: LEAD_STEP_NOT_ON_LEAD };
  return { ok: true, caller, item, routing: await deps.routing() };
}

function refusalFor(c: Extract<Checked, { ok: true }>): string | null {
  return approvalRefusal({
    role: c.caller.role,
    userId: c.caller.userId,
    item: c.item,
    routing: c.routing.status === "ok" ? c.routing.routing : {},
    members: c.routing.status === "ok" ? c.routing.members : [],
  });
}

export async function runLeadStepYes(deps: LeadStepActionDeps, rawLeadId: unknown, rawItemId: unknown, rawShownSha256?: unknown): Promise<YesResult> {
  const leadId = leadIdOf(rawLeadId);
  const itemId = itemIdOf(rawItemId);
  if (!leadId || !itemId) return { ok: false, error: LEAD_STEP_FAILED };
  const c = await checkCallerAndItem(deps, leadId, itemId, LEAD_STEP_NO_APPROVE);
  if (!c.ok) return c;
  const refusal = refusalFor(c);
  if (refusal) return { ok: false, error: refusal };
  const handoff = await deps.handoff(c.item);
  if (handoff.status === "ok" && handoff.holder && handoff.holder.by === c.caller.userId && handoff.holder.userId !== c.caller.userId) {
    return { ok: false, error: LEAD_STEP_HANDED_AWAY };
  }
  const look = await deps.closerLook(c.item);
  if (look === null) return { ok: false, error: LEAD_STEP_CANT_CHECK };
  if (look.linkNotLive) return { ok: false, error: LEAD_STEP_LINK_NOT_LIVE };
  if (look.reasons.length > 0) return { ok: false, error: LEAD_STEP_CLOSER_LOOK };
  // Yes approves the text on screen: the card posts the sha256 of the body it drew; none (or a malformed one) is
  // refused, and the core compares it with the item as re-read (a colleague's edit since is refused there).
  const shownSha256 = typeof rawShownSha256 === "string" && SHOWN_SHA256.test(rawShownSha256) ? rawShownSha256 : null;
  if (!shownSha256) return { ok: false, error: DRAFT_CHANGED_REFRESH };
  const outcome = await deps.review({ id: itemId, intent: "approve", withReceipt: true, requireShown: true, shownSha256 });
  if (outcome.kind === "error") {
    return { ok: false, error: STALE_CONFIRM.test(outcome.error) ? LEAD_PAGE_STALE_DRAFT : outcome.error, ...(outcome.connect ? { connect: outcome.connect } : {}) };
  }
  if (outcome.kind !== "resolved" || outcome.intent !== "approve") return { ok: false, error: LEAD_STEP_FAILED };
  deps.revalidate(leadId);
  const drafterId = outcome.handoff?.drafter ?? null;
  const drafter = drafterId && c.routing.status === "ok" ? c.routing.members.find((m) => m.userId === drafterId) : undefined;
  return { ok: true, message: afterYesSentence(outcome, c.item.type, null, drafter ? memberName(drafter) : null), webLink: outcome.webLink, warn: afterYesWarns(outcome, c.item.type) };
}

export async function runLeadStepNotThis(deps: LeadStepActionDeps, rawLeadId: unknown, rawItemId: unknown, rawReason: unknown): Promise<NotThisResult> {
  const leadId = leadIdOf(rawLeadId);
  const itemId = itemIdOf(rawItemId);
  if (!leadId || !itemId) return { ok: false, error: LEAD_STEP_FAILED };
  const reason = cleanReason(rawReason);
  if (!reason) return { ok: false, error: LEAD_STEP_REASON_NEEDED };
  // The Done marker means "handled without approving"; a person's reason is never that wording.
  if (isDoneNote(reason)) return { ok: false, error: REJECT_NOTE_IS_DONE_MARKER };
  const c = await checkCallerAndItem(deps, leadId, itemId, LEAD_STEP_NO_APPROVE);
  if (!c.ok) return c;
  const refusal = refusalFor(c);
  if (refusal) return { ok: false, error: refusal };
  const outcome = await deps.review({ id: itemId, intent: "reject", note: reason });
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind !== "resolved" || outcome.intent !== "reject") return { ok: false, error: LEAD_STEP_FAILED };
  deps.revalidate(leadId);
  return { ok: true, message: LEAD_STEP_DROPPED };
}

export async function runLeadStepEdit(deps: LeadStepActionDeps, rawLeadId: unknown, rawItemId: unknown, rawBody: unknown): Promise<EditResult> {
  const leadId = leadIdOf(rawLeadId);
  const itemId = itemIdOf(rawItemId);
  if (!leadId || !itemId) return { ok: false, error: LEAD_STEP_FAILED };
  const body = cleanBody(rawBody);
  if (!body) return { ok: false, error: LEAD_STEP_EDIT_EMPTY };
  const c = await checkCallerAndItem(deps, leadId, itemId, LEAD_STEP_NO_EDIT);
  if (!c.ok) return c;
  const outcome = await deps.review({ id: itemId, intent: "save", body });
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind !== "saved") return { ok: false, error: LEAD_STEP_FAILED };
  deps.revalidate(leadId);
  return { ok: true, message: LEAD_STEP_EDIT_SAVED };
}

/** Send back a card handed to the caller, through the deck's own path. Steps 1 to 4 first, like the others. */
export async function runLeadStepSendBack(deps: LeadStepActionDeps, rawLeadId: unknown, rawItemId: unknown, rawNote: unknown): Promise<SendBackResult> {
  const leadId = leadIdOf(rawLeadId);
  const itemId = itemIdOf(rawItemId);
  if (!leadId || !itemId) return { ok: false, error: LEAD_STEP_FAILED };
  // Over the limit is refused, never cut (the same rule as the Approvals page and the deck).
  if (sendBackNoteTooLong(rawNote)) return { ok: false, error: SEND_BACK_NOTE_TOO_LONG };
  const note = typeof rawNote === "string" ? rawNote.replace(/\p{Cf}/gu, "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEND_BACK_NOTE_MAX) : "";
  const c = await checkCallerAndItem(deps, leadId, itemId, LEAD_STEP_NO_EDIT);
  if (!c.ok) return c;
  const sent = await deps.sendBack(itemId, note);
  if (!sent.ok) return sent;
  deps.revalidate(leadId);
  return { ok: true, message: LEAD_STEP_SENT_BACK };
}
