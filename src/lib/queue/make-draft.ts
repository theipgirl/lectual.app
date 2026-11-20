import "server-only";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadCardState, recordCardEvent } from "@/lib/queue/card-state";
import { cardCaller, readCardItem } from "@/lib/queue/card-moves";
import { eventTrust, trustedCardState } from "@/lib/queue/deck";
import { makeDraftDecision, retryPassDecision, type DraftRefusal, type MyOutlookDraftAccess, type RetryPassRefusal } from "@/lib/queue/draft-handoff";
import { passToDrafter } from "@/lib/queue/review-core";
import { memberName } from "@/lib/queue/routing";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { draftInMyOwnOutlook, myOutlookDraftAccess } from "@/lib/mailbox/my-mailbox";
import {
  MAKE_DRAFT_ALREADY,
  MAKE_DRAFT_CHANGED,
  MAKE_DRAFT_COULDNT_CHECK,
  MAKE_DRAFT_DONE,
  MAKE_DRAFT_CLAIMED_FAILED,
  MAKE_DRAFT_CLAIMED_RECONNECT,
  PASS_FAILED,
  PASS_NOT_SWITCHED_ON,
  RETRY_PASS_ALREADY,
  RETRY_PASS_NO_DRAFTER,
  RETRY_PASS_NOT_YOURS,
  passedToDrafter,
  MAKE_DRAFT_FAILED,
  MAKE_DRAFT_NEEDS_PERMISSION,
  MAKE_DRAFT_NO_OUTLOOK,
  MAKE_DRAFT_NOT_APPROVED,
  MAKE_DRAFT_NOT_OUTLOOK,
  MAKE_DRAFT_NOT_YOURS,
  MAKE_DRAFT_OUTLOOK_UNREAD,
  MAKE_DRAFT_PREVIEW_ONLY,
  NOT_SWITCHED_ON,
} from "@/lib/ui/words";

/**
 * "Make the draft in my Outlook" (Sprint 4, decision 3b). The ONE core the Approvals item page and the deck call. On
 * every call it re-resolves the caller from the session (no user, org, role or connection from the browser is used),
 * re-reads the item from the queue and the card events through the scoped client, folds them with `trustedEvents`, and
 * refuses unless the caller is the CURRENT draft_to target of an approved client email whose text still hashes to the
 * approve receipt. Then ONE draft in the caller's OWN Outlook (their scoped read; a posted connection id is only ever
 * compared with it) and a `drafted` event. A second click on a drafted item does nothing. Nothing here sends.
 */

export type MakeDraftResult = { ok: true; message: string; webLink: string | null } | { ok: false; error: string };

const REFUSAL: Record<DraftRefusal, string> = {
  preview: MAKE_DRAFT_PREVIEW_ONLY,
  "not-yours": MAKE_DRAFT_NOT_YOURS,
  "not-approved": MAKE_DRAFT_NOT_APPROVED,
  "not-switched-on": NOT_SWITCHED_ON,
  "couldnt-check": MAKE_DRAFT_COULDNT_CHECK,
  changed: MAKE_DRAFT_CHANGED,
};

export async function makeDraftInMyOutlook(args: { id: string; postedConnectionId?: unknown }): Promise<MakeDraftResult> {
  const session = await resolveFirmSession().catch(() => null);
  const actingAsStaff = !!session && session.kind === "ok" && session.actingAsStaff;
  if (actingAsStaff) return { ok: false, error: MAKE_DRAFT_PREVIEW_ONLY };
  const who = await cardCaller();
  if (!who) return { ok: false, error: MAKE_DRAFT_NOT_YOURS };
  const item = await readCardItem(args.id);
  const [loaded, routed] = await Promise.all([loadCardState([args.id]), loadApprovalRouting()]);
  const trust = eventTrust(routed);
  const state = item ? trustedCardState(loaded, [item], trust) : loaded;
  const decision = makeDraftDecision({ actingAsStaff, callerId: who.userId, callerRole: who.role, item, state, trustKnown: trust.status === "known" });
  if (!decision.ok) return { ok: false, error: REFUSAL[decision.reason] };
  if (decision.already || !item) return { ok: true, message: MAKE_DRAFT_ALREADY, webLink: null };

  // Claim first: the `drafted` row is written BEFORE any mailbox call, so two clicks (two tabs, a double POST) make at most
  // one draft. 0112 allows one `drafted` per item (a unique index); a refused claim is a refusal and nothing is drafted.
  // If the draft then fails, nothing more is written: the claim stands and the person is told to ask Lectual.
  const access = await myOutlookDraftAccess(args.postedConnectionId);
  if (access !== "ready") return { ok: false, error: access === "not-yours" ? MAKE_DRAFT_NOT_YOURS : ACCESS_SENTENCE[access] };
  const claim = await recordCardEvent({ orgId: who.orgId, queueItemId: item.id, kind: "drafted" });
  if (!claim.ok) return { ok: false, error: claim.reason === "conflict" ? MAKE_DRAFT_ALREADY : claim.reason === "not-set-up" ? NOT_SWITCHED_ON : MAKE_DRAFT_FAILED };

  // The approved text, checked above against the receipt; the same subject the approve path drafts with.
  const made = await draftInMyOwnOutlook({
    draft: { to: item.recipient, subject: item.subject ?? item.headline, body: item.final_body ?? item.draft_body },
    postedConnectionId: args.postedConnectionId,
  });
  if (!made.ok) {
    // The claim stands, so there is no silent retry path: a person checks it.
    return { ok: false, error: made.reason === "not-yours" ? MAKE_DRAFT_NOT_YOURS : made.reason === "reauth" ? MAKE_DRAFT_CLAIMED_RECONNECT : MAKE_DRAFT_CLAIMED_FAILED };
  }
  return { ok: true, message: MAKE_DRAFT_DONE, webLink: made.webLink };
}

const ACCESS_SENTENCE: Record<Exclude<MyOutlookDraftAccess, "ready">, string> = {
  "no-mailbox": MAKE_DRAFT_NO_OUTLOOK,
  "not-outlook": MAKE_DRAFT_NOT_OUTLOOK,
  "needs-permission": MAKE_DRAFT_NEEDS_PERMISSION,
  unavailable: MAKE_DRAFT_OUTLOOK_UNREAD,
};

/* ─────────────── "Pass to <drafter>": retry a failed pass (S3) ─────────────── */

const RETRY_REFUSAL: Record<RetryPassRefusal, string> = {
  preview: MAKE_DRAFT_PREVIEW_ONLY,
  "not-yours": RETRY_PASS_NOT_YOURS,
  "not-approved": MAKE_DRAFT_NOT_APPROVED,
  "no-drafter": RETRY_PASS_NO_DRAFTER,
  "not-switched-on": PASS_NOT_SWITCHED_ON,
  "couldnt-check": MAKE_DRAFT_COULDNT_CHECK,
  "already-passed": RETRY_PASS_ALREADY,
  changed: MAKE_DRAFT_CHANGED,
};

/**
 * The approver passes an approved email to the drafter again after a pass that didn't go through. Same write and same
 * trust as the approve path (`passToDrafter`): the caller must be the approver (`resolved_by`), the drafter someone else,
 * no trusted draft_to may exist yet, and the approve receipt must still name the current text. Nothing is drafted here.
 */
export async function retryPassToDrafter(args: { id: string }): Promise<MakeDraftResult> {
  const session = await resolveFirmSession().catch(() => null);
  const actingAsStaff = !!session && session.kind === "ok" && session.actingAsStaff;
  if (actingAsStaff) return { ok: false, error: MAKE_DRAFT_PREVIEW_ONLY };
  const who = await cardCaller();
  if (!who) return { ok: false, error: RETRY_PASS_NOT_YOURS };
  const item = await readCardItem(args.id);
  const [loaded, routed] = await Promise.all([loadCardState([args.id]), loadApprovalRouting()]);
  if (routed.status !== "ok") return { ok: false, error: MAKE_DRAFT_COULDNT_CHECK };
  const trust = eventTrust(routed);
  const state = item ? trustedCardState(loaded, [item], trust) : loaded;
  const decision = retryPassDecision({
    actingAsStaff,
    callerId: who.userId,
    callerRole: who.role,
    callerEmail: who.email,
    item,
    drafter: routed.drafter ?? null,
    state,
    trustKnown: trust.status === "known",
  });
  if (!decision.ok || !item) return { ok: false, error: decision.ok ? MAKE_DRAFT_COULDNT_CHECK : RETRY_REFUSAL[decision.reason] };
  const passed = await passToDrafter({ orgId: who.orgId, itemId: item.id, drafter: decision.drafter, approvedText: item.final_body ?? item.draft_body, approverId: who.userId, item });
  if (!passed.ok) return { ok: false, error: passed.reason === "not-set-up" ? PASS_NOT_SWITCHED_ON : PASS_FAILED };
  const m = routed.members.find((x) => x.userId === decision.drafter);
  return { ok: true, message: passedToDrafter(m ? memberName(m) : "the drafter"), webLink: null };
}
