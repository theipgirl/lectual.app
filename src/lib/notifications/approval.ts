import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { notify } from "./core";
import { NOTIFICATION_KIND_FOR } from "./kinds";

/**
 * "A draft is waiting for your approval": tells the people who may approve a
 * queue item, in the app, that a new one arrived. Called by createDraft after a
 * draft was really queued (not for a deduped one).
 *
 * The recipients are the members whose role is in QUEUE_APPROVE_ROLES, the one
 * list the queue itself gates approval on, minus whoever queued the draft. The
 * payload is the queue id and the headline: never the draft body, the summary,
 * the recipient or the subject, which are privileged client content.
 *
 * Never throws. Internal only: nothing here emails or texts anyone.
 */
export async function notifyApprovers(input: {
  queueId: string;
  headline: string;
  leadId?: string | null;
  leadName?: string | null;
}): Promise<void> {
  try {
    // Background runs (a cron-driven agent) have no signed-in person and so no
    // scoped session. They raise no in-app alert: reaching for the service-role
    // client here would let a job notify under an org it did not prove, so the
    // "Waiting on you" count is what shows those drafts.
    let actorId: string | null;
    try {
      const supabase = await getScopedClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      actorId = user?.id ?? null;
    } catch {
      return;
    }
    if (!actorId) return;

    const directory = await listMemberDirectory();
    const approvers = directory.filter((m) => QUEUE_APPROVE_ROLES.includes(m.role) && m.userId !== actorId);

    const payload = {
      source: "approval_needed",
      queue_id: input.queueId,
      headline: input.headline,
      ...(input.leadName ? { lead_name: input.leadName } : {}),
    };
    for (const approver of approvers) {
      try {
        await notify({
          userId: approver.userId,
          kind: NOTIFICATION_KIND_FOR.approval_needed,
          leadId: input.leadId ?? null,
          actorId,
          payload,
        });
      } catch (err) {
        console.warn(`[notifications] an approval alert was not raised: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[notifications] approval alerts skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
