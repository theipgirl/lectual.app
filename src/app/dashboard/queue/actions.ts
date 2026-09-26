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
      if (editedBody) await saveQueueEdit(qKey, id, editedBody);
      const item = await getQueueItem(qKey, id);
      const resolved = await resolveQueueItem({ orgKey: qKey, id, action: "approve", resolvedBy, ...(note ? { note } : {}) });
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
    return { error: err instanceof Error ? err.message : String(err) };
  }

  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  const sendParam = sendStatus ? `&send=${encodeURIComponent(sendStatus)}` : "";
  redirect(`/dashboard/queue/${id}/?resolved=${intent}${sendParam}`);
}
