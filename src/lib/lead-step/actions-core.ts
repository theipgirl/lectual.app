import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import type { CloserReason } from "@/lib/queue/deck";
import { isDoneNote } from "@/lib/queue/done";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { approvalRefusal, canApproveItem, isAttorneyOnly } from "@/lib/queue/routing";
import type { ReviewInput, ReviewOutcome } from "@/lib/queue/review-core";
import {
  LEAD_STEP_ALREADY_DECIDED,
  LEAD_STEP_APPROVED_DRAFT_FAILED,
  LEAD_STEP_APPROVED_MANUAL,
  LEAD_STEP_APPROVED_NO_DRAFT,
  LEAD_STEP_APPROVED_QUEUE_SENT,
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
  leadStepDraftInMailbox,
} from "@/lib/ui/words";
import type { RoutingFacts } from "./facts";

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
 *   6  approve: the deck's closer-look rule (CHECK FIRST, draft issue, stale draft, linked-proposal gate). Any reason,
 *      or a check that couldn't run, refuses with a fixed sentence: the full approval page is where those are handled.
 *      The stale confirm is never passed from here.
 *   7  the existing core, which checks it all again
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
  /** The deck's closer-look reasons for this item; null when they couldn't be checked. */
  closerLook: (item: QueueItem) => Promise<CloserReason[] | null>;
  /** The existing approve / reject / save core. */
  review: (input: ReviewInput) => Promise<ReviewOutcome>;
  revalidate: (leadId: string) => void;
};

export type YesResult = { ok: true; message: string; webLink: string | null } | { ok: false; error: string };
export type NotThisResult = { ok: true; message: string } | { ok: false; error: string };
export type EditResult = { ok: true; message: string; attorneyOnly: boolean; canYes: boolean } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const REASON_MAX = 200;
export const BODY_MAX = 20_000;

export function leadIdOf(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

export function itemIdOf(raw: unknown): string | null {
  return typeof raw === "string" && QUEUE_ID.test(raw) ? raw : null;
}

/** The Not this reason: control characters become spaces, whitespace collapses, 1 to 200 characters. Null otherwise. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
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
export function afterYesSentence(outcome: Extract<ReviewOutcome, { kind: "resolved" }>, owner: string | null = null): string {
  const send = outcome.send;
  if (send === "mailbox-microsoft" || send === "mailbox-google") {
    const provider = outcome.provider ?? (send === "mailbox-microsoft" ? "microsoft" : "google");
    return leadStepDraftInMailbox(owner, provider === "microsoft" ? "Outlook" : "Gmail");
  }
  if (send === "drafted") return LEAD_STEP_DRAFT_IN_QUEUE_MAILBOX;
  if (send === "manual") return LEAD_STEP_APPROVED_MANUAL;
  if (send === "failed" || send === "mailbox-failed") return LEAD_STEP_APPROVED_DRAFT_FAILED;
  if (send === "sent") return LEAD_STEP_APPROVED_QUEUE_SENT;
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

export async function runLeadStepYes(deps: LeadStepActionDeps, rawLeadId: unknown, rawItemId: unknown): Promise<YesResult> {
  const leadId = leadIdOf(rawLeadId);
  const itemId = itemIdOf(rawItemId);
  if (!leadId || !itemId) return { ok: false, error: LEAD_STEP_FAILED };
  const c = await checkCallerAndItem(deps, leadId, itemId, LEAD_STEP_NO_APPROVE);
  if (!c.ok) return c;
  const refusal = refusalFor(c);
  if (refusal) return { ok: false, error: refusal };
  const look = await deps.closerLook(c.item);
  if (look === null) return { ok: false, error: LEAD_STEP_CANT_CHECK };
  if (look.length > 0) return { ok: false, error: LEAD_STEP_CLOSER_LOOK };
  const outcome = await deps.review({ id: itemId, intent: "approve", withReceipt: true });
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind !== "resolved" || outcome.intent !== "approve") return { ok: false, error: LEAD_STEP_FAILED };
  deps.revalidate(leadId);
  return { ok: true, message: afterYesSentence(outcome), webLink: outcome.webLink };
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
  // Re-classify from the saved text: an edit that reads as legal advice makes the item attorney-only.
  const after = (await deps.readItem(itemId)) ?? { ...c.item, final_body: body };
  const routing = c.routing.status === "ok" ? c.routing.routing : {};
  deps.revalidate(leadId);
  return {
    ok: true,
    message: LEAD_STEP_EDIT_SAVED,
    attorneyOnly: isAttorneyOnly(after),
    canYes: canApproveItem({ role: c.caller.role, userId: c.caller.userId, item: after, routing }),
  };
}
