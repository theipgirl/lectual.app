import "server-only";
import { createHash } from "node:crypto";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getQueueItem, resolveQueueItem, saveQueueEdit } from "@/lib/queue/api";
import { generateApprovedDocument } from "@/lib/documents/approve-hook";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES, resolveQueueRole } from "@/lib/queue/roles";
import { approvalRefusal } from "@/lib/queue/routing";
import { loadApprovalRouting, type RoutingLoad } from "@/lib/queue/routing-load";
import { approvePlan, draftToNote, type ApprovePlan } from "@/lib/queue/draft-handoff";
import { passingSwitchedOn, recordCardEvent } from "@/lib/queue/card-state";
import { cardCaller, staffPreviewRefusal } from "@/lib/queue/card-moves";
import { cardNoticePayload } from "@/lib/queue/handed";
import { notify } from "@/lib/notifications/core";
import { NOTIFICATION_KIND_FOR } from "@/lib/notifications/kinds";
import { prepareMyOutlookDraft, type ApproverOutlook } from "@/lib/mailbox/my-mailbox";
import { INTEGRATIONS_PATH } from "@/lib/setup/routes";
import type { Role } from "@/lib/auth/roles";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { staleWarning } from "@/components/queue/stale-warning";
import { getFirmTimeZone } from "@/lib/org/profile";
import { gateLinkedProposal, makeProposalLive } from "@/lib/consult-proposal/link";
import { approvalBlock, auditDraft } from "@/lib/queue/hygiene";
import { loadAuditContext } from "@/lib/queue/audit-context";
import { shownTextMatches } from "@/lib/queue/shown-text";
import {
  APPROVER_NEEDS_PERMISSION,
  APPROVER_NO_OUTLOOK,
  APPROVER_NO_RECIPIENT,
  APPROVER_NOT_OUTLOOK,
  APPROVER_OUTLOOK_UNREAD,
  APPROVER_REAUTH,
  DRAFT_CHANGED_REFRESH,
} from "@/lib/ui/words";

/**
 * The approve / save / reject core, moved out of `reviewQueueAction` so the approval deck can call it and get a
 * result back instead of a redirect. It lives here, not in the "use server" file, because every export of that file
 * is its own POST endpoint. The rules are the ones the action always had:
 *
 *  · `resolved_by` always comes from the signed-in session, never the form.
 *  · Membership is not authorisation: the role is re-resolved on every call, and approve / reject run the routing
 *    rule (`approvalRefusal`) against the item as re-read from the queue.
 *  · An email carrying a proposal link needs the linked-proposal gate; a body with banner text, a placeholder or
 *    another signer's name is refused (`approvalBlock`); a stale draft needs the explicit confirm.
 *  · An edit is saved BEFORE resolving, so it survives a failed resolve. Rejecting needs a note.
 *  · Approving never sends: a client email becomes a DRAFT in the APPROVER's own Outlook (Approver drafts, Nov 27).
 *    The queue is always asked not to draft it (`mailbox_draft: false`), and the approver's Outlook is checked, with a
 *    fresh token, BEFORE anything is saved, made live or resolved. A person presses Send.
 *  · Sprint 4: with "Drafts go to" set to someone OTHER than the approver, a client email is approved exactly as before,
 *    but NO mailbox draft is made anywhere (the queue is asked not to draft, and the approver's own mailbox is not
 *    used): one `draft_to` card event passes it to the drafter, who makes the draft in their OWN Outlook on their own
 *    click. Before lectual 0112 (the event is refused) it falls back to the approver's OWN mailbox only, never anyone else's.
 */

export type ReviewIntent = "approve" | "reject" | "save";

export type ReviewInput = {
  id: string;
  intent: string;
  /** The edited text, when the form carried one. Blank counts as none. */
  body?: string | null;
  note?: string | null;
  confirmStale?: boolean;
  /**
   * Append "Receipt: sha256 <12 hex>" of the approved text to the approval note. The deck passes true. The full
   * approval page leaves it off for now, so its notes read exactly as before.
   */
  withReceipt?: boolean;
  /**
   * The lead page's Yes and the deck's Yes: approve only the text the person SAW. With `requireShown`, an approve is
   * refused (nothing saved, resolved or drafted) unless `shownSha256` is the sha256 hex of the re-read item's
   * `final_body ?? draft_body`. A missing hash is refused too. The full approval page does not set it: it posts the
   * text it shows as its edit, so what is approved is that text.
   */
  requireShown?: boolean;
  shownSha256?: string | null;
};

export type ReviewOutcome =
  | {
      kind: "error";
      error: string;
      /** Approver drafts: where to connect or reconnect Outlook, when that is what blocked the approve. */
      connect?: string | null;
    }
  | { kind: "saved" }
  | {
      kind: "resolved";
      intent: "approve" | "reject";
      /** The send status the item page shows (`drafted`, `mailbox-microsoft`, `mailbox-failed`, ...); null for a reject. */
      send: string | null;
      /** Link to the mailbox draft, when one was made and the provider gave one. */
      webLink: string | null;
      /** The id of the draft in the approver's OWN mailbox, when this call made it there. */
      draftId: string | null;
      /** Which mailbox holds that draft. */
      provider: "google" | "microsoft" | null;
      /**
       * Sprint 4, present only when "Drafts go to" names someone other than the approver: `passed` (a draft_to was
       * written), `not-switched-on` (before lectual 0112: drafted in the approver's own mailbox instead), `failed`
       * (nothing passed and no draft made anywhere), `queue-drafted` (the queue drafted it although asked not to).
       */
      handoff?: { status: "passed" | "not-switched-on" | "failed" | "queue-drafted"; drafter: string };
      /** The approved item's type (`CLIENT_EMAIL`, `BRIEFING`, ...), so a page never calls a client email "not emailed". */
      itemType?: string;
      /** The approved text, when the draft in the approver's Outlook failed or may have failed, so the page can show it. */
      approvedText?: string;
    };

const FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";

/** Approver drafts: the approver's Outlook isn't ready, so nothing is approved. A fixed sentence, plus the connect link. */
export function approverOutlookBlock(reason: Extract<ApproverOutlook, { ok: false }>["reason"]): Extract<ReviewOutcome, { kind: "error" }> {
  switch (reason) {
    case "no-mailbox":
      return { kind: "error", error: APPROVER_NO_OUTLOOK, connect: INTEGRATIONS_PATH };
    case "not-outlook":
      return { kind: "error", error: APPROVER_NOT_OUTLOOK, connect: INTEGRATIONS_PATH };
    case "needs-permission":
      return { kind: "error", error: APPROVER_NEEDS_PERMISSION, connect: INTEGRATIONS_PATH };
    case "reauth":
      return { kind: "error", error: APPROVER_REAUTH, connect: INTEGRATIONS_PATH };
    default:
      return { kind: "error", error: APPROVER_OUTLOOK_UNREAD, connect: null };
  }
}

/**
 * After a client-email resolve threw: was it approved anyway? `mine` = approved and `resolved_by` is this session's own
 * address; `other` = decided by someone else (or rejected); `pending` = not resolved; `unknown` = the re-read failed.
 */
async function resolveAfterThrow(qKey: string, id: string, resolvedBy: string): Promise<"mine" | "other" | "pending" | "unknown"> {
  let again: Awaited<ReturnType<typeof getQueueItem>>;
  try {
    again = await getQueueItem(qKey, id);
  } catch {
    return "unknown";
  }
  if (again.status === "pending") return "pending";
  if (again.status === "approved" && (again.resolved_by ?? "").trim().toLowerCase() === resolvedBy.trim().toLowerCase()) return "mine";
  return "other";
}

async function prepareOutlookSafely(): Promise<ApproverOutlook> {
  try {
    return await prepareMyOutlookDraft();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** The first 12 hex characters of the text's sha256: a receipt of exactly what was approved. */
export function approvalReceipt(text: string): string {
  return `Receipt: sha256 ${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

/** The signed-in reviewer, with the role re-resolved now. Throws a sentence when signed out or not allowed. */
/** A refusal whose message is a fixed sentence written for a person (safe to show). Anything else thrown is not. */
export class ReviewerRefusal extends Error {}

/** Shown when an item was already approved or rejected (a second tab, a replayed POST): nothing is resolved twice. */
export const ALREADY_DECIDED = "This card was already decided.";

export async function requireFirmReviewer(allowed: Role[], verb: string): Promise<{ email: string; userId: string; role: Role }> {
  const supabase = await getScopedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new ReviewerRefusal("You must be signed in to review queue items.");
  const role = await resolveQueueRole(supabase, allowed);
  if (!role) throw new ReviewerRefusal(`You don't have permission to ${verb} client communications.`);
  return { email: user.email, userId: user.id, role };
}

/**
 * The one pass write (the approve path and the approver's "Pass to <drafter>" retry): one `draft_to` to the drafter with
 * the approved text's sha256, then the bell (ids and a clipped headline only; notify() never throws).
 */
export async function passToDrafter(args: { orgId: string; itemId: string; drafter: string; approvedText: string; approverId: string; item: { id: string; headline: string } }) {
  const passed = await recordCardEvent({ orgId: args.orgId, queueItemId: args.itemId, kind: "draft_to", targetUserId: args.drafter, note: draftToNote(args.approvedText) });
  if (passed.ok) await notify({ userId: args.drafter, kind: NOTIFICATION_KIND_FOR.approval_needed, actorId: args.approverId, payload: cardNoticePayload("draft_to", args.item) });
  return passed;
}

export async function runQueueReview(input: ReviewInput): Promise<ReviewOutcome> {
  const id = input.id;
  const intent = input.intent;
  const note = (input.note ?? "").trim();
  const editedBody = typeof input.body === "string" && input.body.trim() ? input.body : null;
  if (!id) return { kind: "error", error: "Missing queue item id." };

  const qKey = await activeQueueOrgKey();
  if (!qKey) return { kind: "error", error: "No approval queue is configured for this firm." };

  // Staff roles get through the door; WHICH items they may approve is the routing rule below (src/lib/queue/routing.ts).
  const verb = intent === "save" ? "edit" : "approve or reject";
  let resolvedBy: string;
  let caller: { userId: string; role: Role };
  try {
    const reviewer = await requireFirmReviewer(QUEUE_EDIT_ROLES, verb);
    resolvedBy = reviewer.email;
    caller = { userId: reviewer.userId, role: reviewer.role };
  } catch (err) {
    // Only our own fixed sentences reach the screen; anything else (an auth or network error) is a fixed sentence too.
    return { kind: "error", error: err instanceof ReviewerRefusal ? err.message : "You must be signed in." };
  }

  // Approve and reject: the item's kind and owner decide who may. Re-read here on every submit; the role and the
  // owner never come from the form. A routing read that fails means the default rule (the usual approvers).
  let routed: RoutingLoad | null = null;
  let plan: ApprovePlan = "today";
  let passOrgId: string | null = null;
  let clientEmail = false;
  let outlook: Extract<ApproverOutlook, { ok: true }> | null = null;
  if (intent === "approve" || intent === "reject") {
    let target: Awaited<ReturnType<typeof getQueueItem>>;
    try {
      target = await getQueueItem(qKey, id);
    } catch {
      return { kind: "error", error: FAILED };
    }
    // Decided already (another tab, a replayed deck POST): never resolve twice, never make a second mailbox draft.
    if (target.status !== "pending") return { kind: "error", error: ALREADY_DECIDED };
    routed = await loadApprovalRouting();
    // An approval covers the text that would go out, so an edit in this form is checked too, not only the stored item.
    const checked = intent === "approve" && editedBody ? { ...target, final_body: editedBody } : target;
    const refusal = approvalRefusal({
      ...caller,
      item: checked,
      routing: routed.status === "ok" ? routed.routing : {},
      members: routed.status === "ok" ? routed.members : [],
    });
    if (refusal) return { kind: "error", error: refusal };

    // Sprint 4: who makes the mailbox draft. Only a routing that was READ and names a drafter other than the approver
    // passes it on; anything else (no drafter, a failed read, not a client email) is today's path, unchanged.
    clientEmail = intent === "approve" && target.type === "CLIENT_EMAIL";
    if (clientEmail) {
      // Lectual staff viewing as the firm: no own Outlook here and no membership for a draft_to. Refused before anything.
      const preview = await staffPreviewRefusal();
      if (preview) return { kind: "error", error: preview };
      // No recipient means no draft can be addressed: refused before anything is saved, made live or resolved.
      if (!target.recipient?.trim()) return { kind: "error", error: APPROVER_NO_RECIPIENT };
    }
    if (intent === "approve" && routed.status === "ok") {
      plan = approvePlan({ approverId: caller.userId, drafter: routed.drafter, itemType: target.type });
      if (plan === "pass") {
        const who = await cardCaller();
        if (!who || who.userId !== caller.userId) return { kind: "error", error: FAILED };
        passOrgId = who.orgId;
      }
    }
    // Approver drafts (Nov 27): whose Outlook gets the draft. The approver's, unless "Drafts go to" passes it to someone
    // else (`pass`), whose own Outlook can't be checked from here (a personal connection is visible only to its owner):
    // they make the draft on their own click. Before lectual 0112 a pass falls back to the approver's own Outlook, so
    // the approver is checked then too. Checked, with a fresh token, BEFORE anything is saved, made live or resolved.
    if (clientEmail && (plan !== "pass" || (await passingSwitchedOn()) === "no")) {
      const ready = await prepareOutlookSafely();
      if (!ready.ok) return approverOutlookBlock(ready.reason);
      outlook = ready;
    }
  }

  let sendStatus: string | null = null;
  let webLink: string | null = null;
  let draftId: string | null = null;
  let provider: "google" | "microsoft" | null = null;
  try {
    if (intent === "save") {
      if (!editedBody) return { kind: "error", error: "Nothing to save — the draft is empty." };
      await saveQueueEdit(qKey, id, editedBody);
      return { kind: "saved" };
    }

    if (intent === "approve") {
      // An email that carries a proposal link (the consult agent's) needs a named proposal approver AND an approved
      // proposal. Checked first, and again on every submit. Fails closed when the link can't be read.
      const gate = await gateLinkedProposal(id);
      if (!gate.ok) return { kind: "error", error: gate.error };

      // The stale-draft check runs again HERE, server-side: a hand-posted form must not skip it.
      const before = await getQueueItem(qKey, id);
      if (before.status !== "pending") return { kind: "error", error: ALREADY_DECIDED };
      if (input.requireShown && (editedBody || !input.shownSha256 || !shownTextMatches(before, input.shownSha256))) {
        return { kind: "error", error: DRAFT_CHANGED_REFRESH };
      }

      // What would actually go out: the edit in this form, else what is saved. Checked before anything is saved or
      // resolved, so a refused body is never stored as the final text.
      const outgoing = editedBody ?? before.final_body ?? before.draft_body;
      const blocked = approvalBlock(auditDraft(outgoing, { type: before.type, ...(await loadAuditContext()) }));
      if (blocked) return { kind: "error", error: blocked };

      const stale = await checkDraftStaleness(before);
      const confirmed = input.confirmStale === true;
      if (stalenessRequiresConfirm(stale) && !confirmed) {
        const warning = staleWarning(stale, await getFirmTimeZone());
        return {
          kind: "error",
          error: `${warning?.headline ?? "This client's status changed since the draft was queued"}. Tick the confirmation box to approve it anyway, or reject it.`,
        };
      }
      const staleNote =
        stalenessRequiresConfirm(stale) && confirmed
          ? `Approved after a stale-draft warning: ${staleWarning(stale, await getFirmTimeZone())?.headline ?? "status changed"}.`
          : null;

      if (editedBody) await saveQueueEdit(qKey, id, editedBody);
      const item = await getQueueItem(qKey, id);
      // Again on the read the approval is built from, so an edit that lands in between is not approved unseen.
      if (input.requireShown && (!input.shownSha256 || !shownTextMatches(item, input.shownSha256))) {
        return { kind: "error", error: DRAFT_CHANGED_REFRESH };
      }
      const approvedText = editedBody ?? item.final_body ?? item.draft_body;
      // Re-classify the item as re-read (an edit in between may have added legal-advice text, which makes it
      // attorney-only): refused before it is resolved or drafted.
      if (routed) {
        const again = approvalRefusal({
          ...caller,
          item: { ...item, final_body: approvedText },
          routing: routed.status === "ok" ? routed.routing : {},
          members: routed.status === "ok" ? routed.members : [],
        });
        if (again) return { kind: "error", error: again };
      }
      // A pass to the drafter always carries the receipt: "Make the draft" requires it and checks it against the text.
      const receipt = input.withReceipt || plan === "pass" ? approvalReceipt(approvedText) : null;
      const approvalNote = [note, staleNote, receipt].filter(Boolean).join("\n") || null;

      // The proposal link goes live now, BEFORE the queue item is resolved: resolving can itself create the mailbox
      // draft, so this is the only point that comes before EVERY mailbox draft.
      if (gate.proposal && gate.proposal.status === "approved") {
        const live = await makeProposalLive(gate.proposal.id);
        if (!live.ok) {
          return {
            kind: "error",
            error: `The proposal link could not be made live (${live.error}), so nothing was approved and no mailbox draft was created. Open the proposal, check it is still approved, and try again.`,
          };
        }
      }

      // The text that was re-read and re-classified is sent as the final body on EVERY approve, so an edit a colleague
      // saves after the re-read is never what gets approved (or drafted).
      let resolved: Awaited<ReturnType<typeof resolveQueueItem>>;
      try {
        resolved = await resolveQueueItem({
          orgKey: qKey,
          id,
          action: "approve",
          resolvedBy,
          ...(approvalNote ? { note: approvalNote } : {}),
          finalBody: approvedText,
          // Approver drafts: a client email is NEVER drafted by the queue (in the firm's mailbox); the approver's own Outlook
          // gets it below, or the drafter's on their own click. lawmatics-mcp honours this from its main 3a02854.
          ...(clientEmail ? { skipMailboxDraft: true } : {}),
        });
      } catch (err) {
        // A client email whose resolve threw (a timeout, a 5xx) may still have been approved by the queue. Never leave an
        // approved email with no draft and a "didn't go through": re-read it and decide.
        if (!clientEmail) throw err;
        const after = await resolveAfterThrow(qKey, id, resolvedBy);
        if (after === "pending") throw err;
        if (after === "other") return { kind: "error", error: ALREADY_DECIDED };
        if (after === "unknown") {
          console.error("[queue] resolve threw and the re-read failed:", err instanceof Error ? err.name : typeof err);
          return { kind: "resolved", intent: "approve", send: "mailbox-uncertain", webLink: null, draftId: null, provider: null, itemType: item.type, approvedText };
        }
        // Approved by this session (mailbox_draft false was sent): carry on to the one draft, exactly as after a resolve.
        resolved = { status: "approved", send: "manual" };
      }
      sendStatus = resolved.send;
      // lawmatics-mcp returns the draft link at `draft.webLink`; `sendResult.webLink` is the older shape.
      webLink = resolved.draft?.webLink ?? resolved.sendResult?.webLink ?? null;

      // ONE Graph POST with the approver's token taken before the resolve. Never retried automatically: a definite refusal
      // is `mailbox-failed`, a maybe (5xx, timeout) is `mailbox-uncertain` ("check your Drafts").
      const draftInOwnMailbox = async () => {
        const ready = outlook ?? (await prepareOutlookSafely());
        if (!ready.ok) {
          sendStatus = "mailbox-failed";
          return;
        }
        const made = await ready.draft({ to: item.recipient, subject: item.subject ?? item.headline, body: approvedText });
        if (made.ok) {
          sendStatus = "mailbox-microsoft";
          webLink = made.webLink ?? null;
          draftId = made.id ?? null;
          provider = "microsoft";
        } else {
          // The reason only: a provider error can carry addresses or message text.
          console.error("[queue] approver draft failed:", made.reason);
          sendStatus = made.reason === "uncertain" ? "mailbox-uncertain" : "mailbox-failed";
        }
      };
      let handoff: { status: "passed" | "not-switched-on" | "failed" | "queue-drafted"; drafter: string } | undefined;
      const drafter = routed && routed.status === "ok" ? (routed.drafter ?? null) : null;
      if (plan === "pass" && drafter && passOrgId && item.type === "CLIENT_EMAIL") {
        if (sendStatus === "drafted" || sendStatus === "sent") {
          // The queue drafted it although asked not to: never a second draft, and nothing passed on.
          handoff = { status: "queue-drafted", drafter };
        } else {
          const passed = await passToDrafter({ orgId: passOrgId, itemId: id, drafter, approvedText, approverId: caller.userId, item });
          if (passed.ok) {
            handoff = { status: "passed", drafter };
            sendStatus = "passed";
          } else if (passed.reason === "not-set-up") {
            // Before lectual 0112: today's behaviour, and ONLY the approver's own mailbox.
            handoff = { status: "not-switched-on", drafter };
            await draftInOwnMailbox();
          } else {
            // Nothing passed and no draft made anywhere: a person drafts it from the approved item. The outcome is recorded
            // as a `pass_failed` marker (no text) so the approver's "Pass to <drafter>" is offered for THIS item only;
            // if the marker can't be written either, no retry is offered (never a second draft on a guess).
            handoff = { status: "failed", drafter };
            sendStatus = "pass-failed";
            await recordCardEvent({ orgId: passOrgId, queueItemId: id, kind: "pass_failed" });
          }
        }
      } else if (clientEmail && sendStatus !== "drafted" && sendStatus !== "sent") {
        await draftInOwnMailbox();
      }
      const draftMissing = sendStatus === "mailbox-failed" || sendStatus === "mailbox-uncertain";

      // Document Center: an approved letter draft becomes a real .docx now. Best-effort, wrapped again so a docx bug
      // can never turn a successful approval into a failed submission.
      try {
        await generateApprovedDocument(qKey, id);
      } catch (err) {
        console.error("[document-center] post-approve hook threw unexpectedly:", err instanceof Error ? err.name : typeof err);
      }
      return {
        kind: "resolved",
        intent: "approve",
        send: sendStatus,
        webLink,
        draftId,
        provider,
        itemType: item.type,
        ...(handoff ? { handoff } : {}),
        ...(draftMissing ? { approvedText } : {}),
      };
    }

    if (intent === "reject") {
      if (!note) return { kind: "error", error: "Add a short note explaining the rejection — it feeds the improvement loop." };
      await resolveQueueItem({ orgKey: qKey, id, action: "reject", resolvedBy, note });
      return { kind: "resolved", intent: "reject", send: null, webLink: null, draftId: null, provider: null };
    }
    return { kind: "error", error: "Unknown action." };
  } catch (err) {
    console.error("[queue] the action failed:", err instanceof Error ? err.name : typeof err);
    return { kind: "error", error: FAILED };
  }
}
