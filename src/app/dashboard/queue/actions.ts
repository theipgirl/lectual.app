"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getQueueItem, resolveQueueItem, saveQueueEdit } from "@/lib/queue/api";
import { generateApprovedDocument } from "@/lib/documents/approve-hook";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_APPROVE_ROLES, QUEUE_EDIT_ROLES, resolveQueueRole } from "@/lib/queue/roles";
import { draftInMyMailbox } from "@/lib/mailbox/my-mailbox";
import type { Role } from "@/lib/auth/roles";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { staleWarning } from "@/components/queue/stale-warning";
import { getFirmTimeZone } from "@/lib/org/profile";
import { gateLinkedProposal, makeProposalLive } from "@/lib/consult-proposal/link";
import { approvalBlock, auditDraft } from "@/lib/queue/hygiene";
import { loadAuditContext } from "@/lib/queue/audit-context";

export type ReviewState = { error?: string };

/**
 * Approve / save / reject one queue item. Ported from lectual's
 * (firm)/dashboard/queue/actions.ts; the rules are unchanged:
 *
 *  · `resolved_by` always comes from the signed-in session, never the form.
 *  · Membership is not authorisation: saving an edit needs QUEUE_EDIT_ROLES,
 *    approving or rejecting needs QUEUE_APPROVE_ROLES, re-checked here on
 *    every submit (the queue is outside Postgres, so RLS can't do it).
 *  · An edit is saved BEFORE resolving, so it survives a failed resolve.
 *  · Rejecting needs a note.
 *
 * New here: when an approved CLIENT_EMAIL has no send channel on the queue
 * service's side, it is created as a DRAFT in the approver's own connected
 * mailbox (src/lib/mailbox/my-mailbox.ts). Still never sent — the approver
 * presses Send in Gmail or Outlook.
 */
async function requireFirmReviewer(allowed: Role[], verb: string): Promise<{ email: string }> {
  const supabase = await getScopedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("You must be signed in to review queue items.");
  const role = await resolveQueueRole(supabase, allowed);
  if (!role) throw new Error(`You don't have permission to ${verb} client communications.`);
  return { email: user.email };
}

export async function reviewQueueAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const body = formData.get("body");
  const note = String(formData.get("note") ?? "").trim();
  const editedBody = typeof body === "string" && body.trim() ? body : null;
  if (!id) return { error: "Missing queue item id." };

  const qKey = await activeQueueOrgKey();
  if (!qKey) return { error: "No approval queue is configured for this firm." };

  const allowed = intent === "save" ? QUEUE_EDIT_ROLES : QUEUE_APPROVE_ROLES;
  const verb = intent === "save" ? "edit" : "approve or reject";
  let resolvedBy: string;
  try {
    ({ email: resolvedBy } = await requireFirmReviewer(allowed, verb));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You must be signed in." };
  }

  let sendStatus: string | null = null;
  try {
    if (intent === "save") {
      if (!editedBody) return { error: "Nothing to save — the draft is empty." };
      await saveQueueEdit(qKey, id, editedBody);
      revalidatePath(`/dashboard/queue/${id}/`);
      return {};
    }

    if (intent === "approve") {
      // An email that carries a proposal link (the consult agent's) needs a
      // named proposal approver AND an approved proposal. Checked first, and
      // again on every submit: the panel on the page is a courtesy. Fails
      // closed when the link can't be read.
      const gate = await gateLinkedProposal(id);
      if (!gate.ok) return { error: gate.error };

      // The stale-draft check runs again HERE, server-side: the page's
      // checkbox is a courtesy, and a hand-posted form must not skip it. A
      // client who signed or paid since this was queued (or a check that
      // couldn't run) needs the approver's explicit confirm, and the approval
      // note records that they gave it. Never an automatic reject.
      const before = await getQueueItem(qKey, id);

      // What would actually go out: the edit in this form, else what is saved.
      // Banner and worksheet text, an unresolved placeholder or another
      // member's signature stop an approval of a client email. Checked before
      // anything is saved or resolved, so a refused body is never stored as the
      // final text. Reject and Save are never held up by it.
      const blocked = approvalBlock(
        auditDraft(editedBody ?? before.final_body ?? before.draft_body, { type: before.type, ...(await loadAuditContext()) }),
      );
      if (blocked) return { error: blocked };

      const stale = await checkDraftStaleness(before);
      const confirmed = formData.get("confirm_stale") === "yes";
      if (stalenessRequiresConfirm(stale) && !confirmed) {
        const warning = staleWarning(stale, await getFirmTimeZone());
        return {
          error: `${warning?.headline ?? "This client's status changed since the draft was queued"}. Tick the confirmation box to approve it anyway, or reject it.`,
        };
      }
      const staleNote =
        stalenessRequiresConfirm(stale) && confirmed
          ? `Approved after a stale-draft warning: ${staleWarning(stale, await getFirmTimeZone())?.headline ?? "status changed"}.`
          : null;
      const approvalNote = [note, staleNote].filter(Boolean).join("\n") || null;

      if (editedBody) await saveQueueEdit(qKey, id, editedBody);
      const item = await getQueueItem(qKey, id);

      // The proposal link goes live now, BEFORE the queue item is resolved:
      // resolving can itself create the mailbox draft (the queue service's
      // own Outlook channel, send = "drafted"), so this is the only point that
      // comes before EVERY mailbox draft. If the link can't be made live,
      // nothing is approved and no draft exists anywhere: an email pointing at
      // a dead link is worse than a delay. (If the resolve below then fails,
      // the link is live with no email yet; approving again finds the
      // proposal sent and goes straight on.)
      if (gate.proposal && gate.proposal.status === "approved") {
        const live = await makeProposalLive(gate.proposal.id);
        if (!live.ok) {
          return {
            error: `The proposal link could not be made live (${live.error}), so nothing was approved and no mailbox draft was created. Open the proposal, check it is still approved, and try again.`,
          };
        }
      }

      const resolved = await resolveQueueItem({ orgKey: qKey, id, action: "approve", resolvedBy, ...(approvalNote ? { note: approvalNote } : {}) });
      sendStatus = resolved.send;

      // No channel on the queue side: draft it in the approver's own mailbox.
      if (item.type === "CLIENT_EMAIL" && sendStatus !== "drafted" && sendStatus !== "sent") {
        try {
          const made = await draftInMyMailbox({
            to: item.recipient,
            subject: item.subject ?? item.headline,
            body: editedBody ?? item.final_body ?? item.draft_body,
          });
          if (made) sendStatus = `mailbox-${made.provider}`;
        } catch (err) {
          console.error("[queue] mailbox draft failed", err);
          sendStatus = "mailbox-failed";
        }
      }

      // Document Center: an approved letter draft becomes a real .docx now.
      // Best-effort (the hook itself never throws); wrapped again so a docx
      // bug can never turn a successful approval into a failed submission.
      try {
        await generateApprovedDocument(qKey, id);
      } catch (err) {
        console.error("[document-center] post-approve hook threw unexpectedly", err);
      }
    } else if (intent === "reject") {
      if (!note) return { error: "Add a short note explaining the rejection — it feeds the improvement loop." };
      await resolveQueueItem({ orgKey: qKey, id, action: "reject", resolvedBy, note });
    } else {
      return { error: "Unknown action." };
    }
  } catch (err) {
    console.error("[queue] the action failed:", err instanceof Error ? err.name : typeof err);
    return { error: "That didn't go through. Nothing was sent. Refresh to try again." };
  }

  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  const sendParam = sendStatus ? `&send=${encodeURIComponent(sendStatus)}` : "";
  redirect(`/dashboard/queue/${id}/?resolved=${intent}${sendParam}`);
}
