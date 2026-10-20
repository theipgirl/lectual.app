import { getScopedClient } from "@/lib/db/scoped-client";
import { logActivity } from "@/lib/matters";
import { listMemberDirectory } from "@/lib/members/directory";
import { notify } from "@/lib/notifications";
import { NOTIFICATION_KIND_FOR } from "@/lib/notifications/kinds";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "./leads";
import { NOTE_MAX_LENGTH } from "./lead-input";
import { LeadWriteError, forbiddenLeadWrite } from "./errors";
import { CONSULT_OUTCOME_LABEL, isConsultOutcome } from "./consult-outcome-labels";

export {
  CONSULT_OUTCOMES,
  CONSULT_OUTCOME_LABEL,
  isConsultOutcome,
  type ConsultOutcome,
} from "./consult-outcome-labels";

export type LogConsultOutcomeInput = {
  outcome?: string | null;
  note?: string | null;
};

/**
 * Records what happened to a consult (no-show, asked to reschedule, rebooked
 * after a no-show) on the lead's timeline and tells the people who follow up.
 *
 * The activity row IS the mutation, so a failed write throws to the person who
 * logged it. Everything after it is best-effort: a notification that fails to
 * raise is warned about and never makes the save look failed (the same rule
 * addLeadNote follows for @mentions).
 *
 * Internal only. It writes one `call_logged` row and raises in-app
 * notifications through notify(); no draft is queued and nothing reaches the
 * client, which the approval queue alone can do.
 */
export async function logConsultOutcome(leadId: string, input: LogConsultOutcomeInput): Promise<void> {
  if (!leadId) throw new LeadWriteError("Missing lead.");
  if (!isConsultOutcome(input.outcome)) throw new LeadWriteError("Choose what happened to the consult.");
  const outcome = input.outcome;
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX_LENGTH) {
    throw new LeadWriteError(`Keep the note under ${NOTE_MAX_LENGTH} characters.`);
  }

  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "log a consult outcome");
  }

  // Through the caller's own client: a lead outside their firm is simply absent.
  const { data: lead, error: leadError } = await supabase
    .from("crm_lead")
    .select("first_name, last_name, email, assigned_to")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) throw new LeadWriteError("Lead not found.");

  const label = CONSULT_OUTCOME_LABEL[outcome];
  await logActivity({
    type: "call_logged",
    leadId,
    actorType: "user",
    payload: { summary: label, notes: note || null, consult_outcome: outcome },
  });

  const leadName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || lead.email || "a lead";
  try {
    await notifyFollowUp({ supabase, leadId, ownerId: lead.assigned_to, outcome, label, leadName });
  } catch (err) {
    console.warn(
      `[consult-outcome] could not raise notifications: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The lead's owner plus every `intake`-role member, minus whoever logged it, once each. */
async function notifyFollowUp(args: {
  supabase: Awaited<ReturnType<typeof getScopedClient>>;
  leadId: string;
  ownerId: string | null;
  outcome: string;
  label: string;
  leadName: string;
}): Promise<void> {
  const { supabase, leadId, ownerId, outcome, label, leadName } = args;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;

  const directory = await listMemberDirectory();
  const recipients = new Set<string>();
  if (ownerId) recipients.add(ownerId);
  for (const member of directory) if (member.role === "intake") recipients.add(member.userId);
  if (actorId) recipients.delete(actorId);
  if (recipients.size === 0) return;

  // logActivity has no RETURNING, so the row just written is looked up by its
  // own shape, as addLeadNote does. Without it the notification still goes out.
  let activityId: string | null = null;
  if (actorId) {
    try {
      const { data: latest } = await supabase
        .from("crm_activity")
        .select("id")
        .eq("lead_id", leadId)
        .eq("type", "call_logged")
        .eq("actor_id", actorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      activityId = latest?.id ?? null;
    } catch {
      // best-effort
    }
  }

  // The kind comes from NOTIFICATION_KIND_FOR: `mentioned` today, because a dedicated one
  // needs a migration in lectual (docs/notifications.md). `preview` carries the
  // sentence so any renderer can show what happened.
  const payload = { lead_name: leadName, preview: `${label}: ${leadName}`, source: "consult_outcome", outcome };
  for (const userId of recipients) {
    try {
      await notify({ userId, kind: NOTIFICATION_KIND_FOR.consult_outcome, leadId, activityId, actorId, payload });
    } catch (err) {
      console.warn(
        `[consult-outcome] a notification was not raised: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
