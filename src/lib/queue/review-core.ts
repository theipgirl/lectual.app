import "server-only";
import { createHash } from "node:crypto";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getQueueItem, resolveQueueItem, saveQueueEdit } from "@/lib/queue/api";
import { generateApprovedDocument } from "@/lib/documents/approve-hook";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES, resolveQueueRole } from "@/lib/queue/roles";
import { approvalRefusal } from "@/lib/queue/routing";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { draftInMyMailbox } from "@/lib/mailbox/my-mailbox";
import type { Role } from "@/lib/auth/roles";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { staleWarning } from "@/components/queue/stale-warning";
import { getFirmTimeZone } from "@/lib/org/profile";
import { gateLinkedProposal, makeProposalLive } from "@/lib/consult-proposal/link";
import { approvalBlock, auditDraft } from "@/lib/queue/hygiene";
import { loadAuditContext } from "@/lib/queue/audit-context";

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
 *  · Approving never sends: a client email becomes a DRAFT (the queue's own channel, else the approver's own
 *    mailbox). A person presses Send.
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
};

export type ReviewOutcome =
  | { kind: "error"; error: string }
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
    };

const FAILED = "That didn't go through. Nothing was sent. Refresh to try again.";

/** The first 12 hex characters of the text's sha256: a receipt of exactly what was approved. */
export function approvalReceipt(text: string): string {
  return `Receipt: sha256 ${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

/** The signed-in reviewer, with the role re-resolved now. Throws a sentence when signed out or not allowed. */
export async function requireFirmReviewer(allowed: Role[], verb: string): Promise<{ email: string; userId: string; role: Role }> {
  const supabase = await getScopedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("You must be signed in to review queue items.");
  const role = await resolveQueueRole(supabase, allowed);
  if (!role) throw new Error(`You don't have permission to ${verb} client communications.`);
  return { email: user.email, userId: user.id, role };
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
    return { kind: "error", error: err instanceof Error ? err.message : "You must be signed in." };
  }

  // Approve and reject: the item's kind and owner decide who may. Re-read here on every submit; the role and the
  // owner never come from the form. A routing read that fails means the default rule (the usual approvers).
  if (intent === "approve" || intent === "reject") {
    let target: Awaited<ReturnType<typeof getQueueItem>>;
    try {
      target = await getQueueItem(qKey, id);
    } catch {
      return { kind: "error", error: FAILED };
    }
    const routed = await loadApprovalRouting();
    // An approval covers the text that would go out, so an edit in this form is checked too, not only the stored item.
    const checked = intent === "approve" && editedBody ? { ...target, final_body: editedBody } : target;
    const refusal = approvalRefusal({
      ...caller,
      item: checked,
      routing: routed.status === "ok" ? routed.routing : {},
      members: routed.status === "ok" ? routed.members : [],
    });
    if (refusal) return { kind: "error", error: refusal };
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
      const approvedText = editedBody ?? item.final_body ?? item.draft_body;
      const receipt = input.withReceipt ? approvalReceipt(approvedText) : null;
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

      const resolved = await resolveQueueItem({ orgKey: qKey, id, action: "approve", resolvedBy, ...(approvalNote ? { note: approvalNote } : {}) });
      sendStatus = resolved.send;
      webLink = resolved.sendResult?.webLink ?? null;

      // No channel on the queue side: draft it in the approver's own mailbox.
      if (item.type === "CLIENT_EMAIL" && sendStatus !== "drafted" && sendStatus !== "sent") {
        try {
          const made = await draftInMyMailbox({
            to: item.recipient,
            subject: item.subject ?? item.headline,
            body: approvedText,
          });
          if (made) {
            sendStatus = `mailbox-${made.provider}`;
            webLink = made.webLink ?? null;
            draftId = made.id ?? null;
            provider = made.provider;
          }
        } catch (err) {
          console.error("[queue] mailbox draft failed", err);
          sendStatus = "mailbox-failed";
        }
      }

      // Document Center: an approved letter draft becomes a real .docx now. Best-effort, wrapped again so a docx bug
      // can never turn a successful approval into a failed submission.
      try {
        await generateApprovedDocument(qKey, id);
      } catch (err) {
        console.error("[document-center] post-approve hook threw unexpectedly", err);
      }
      return { kind: "resolved", intent: "approve", send: sendStatus, webLink, draftId, provider };
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
