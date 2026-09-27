import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireAutomationStaffRole, currentOrgId } from "@/lib/automation/rules";
import { listSteps, type DripEnrollment, type DripStep } from "@/lib/automation/drips";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { addDelay, leadDisplayName, leadTemplateVars, renderTemplate } from "./steps";

/**
 * Advances ONE enrollment by exactly one step. This is the only place a drip
 * sequence's steps actually run — there is no cron/background runner in this
 * app, so staff trigger it by hand from the campaign's enrollment table
 * ("Send next step" / "Run step"). That is a deliberate scope cut, not an
 * oversight: see PORTED_FROM.md and this feature's report.
 *
 * ── AN EMAIL STEP NEVER SENDS — IT ONLY DRAFTS ───────────────────────────────
 * `type: "email"` renders the step's template against the enrolled lead's own
 * fields and calls `createDraft` (src/lib/queue/api.ts) exactly like every
 * other agent in this app. The queue is the ONLY path by which a campaign's
 * words could ever reach a client, and this function never calls anything
 * else that could deliver mail. If `drips.ts` or the queue client ever grow a
 * direct-send path, this function must not be wired to it.
 *
 * ── STAFF-GATED, NOT ADMIN-GATED ─────────────────────────────────────────────
 * Running a step is an operational action (like enrolling a lead), so it uses
 * `requireAutomationStaffRole` — the same gate `enrollLead` and
 * `setEnrollmentStatus` use, mirroring `crm_drip_enrollment`'s own
 * `*_staff` RLS policies.
 */
export class CampaignAdvanceError extends Error {}

type Lead = Database["public"]["Tables"]["crm_lead"]["Row"];
type EmailTemplateRow = Database["public"]["Tables"]["crm_email_template"]["Row"];

export type AdvanceResult = { queueItemId: string | null; completed: boolean; stepType: DripStep["type"] };

async function loadEnrollment(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  id: string,
): Promise<DripEnrollment> {
  const { data, error } = await supabase
    .from("crm_drip_enrollment")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CampaignAdvanceError("This enrollment no longer exists.");
  return data;
}

async function loadLead(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  leadId: string,
): Promise<Lead> {
  const { data, error } = await supabase.from("crm_lead").select("*").eq("id", leadId).maybeSingle();
  if (error) throw error;
  if (!data) throw new CampaignAdvanceError("The enrolled lead could not be found.");
  return data;
}

async function loadTemplate(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  templateId: string,
): Promise<EmailTemplateRow> {
  const { data, error } = await supabase
    .from("crm_email_template")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CampaignAdvanceError("This step's email template could not be found.");
  return data;
}

type EnrollmentPatch = Database["public"]["Tables"]["crm_drip_enrollment"]["Update"];

/**
 * Moves an enrollment from step `fromStep` to its next state, but ONLY if it
 * is still active and still on `fromStep` — a compare-and-set on the row.
 *
 * This is what stops two clicks on "Run next step" (a double-submit, two
 * staff on the same page, a retried POST) from both running the same step:
 * whichever request claims the row first runs it, the other matches zero
 * rows and is refused. Without it, both would read current_step = N and
 * both would draft the same client email into the queue.
 */
async function claimStep(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  enrollmentId: string,
  fromStep: number,
  patch: EnrollmentPatch,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("crm_drip_enrollment")
    .update(patch)
    .eq("id", enrollmentId)
    .eq("status", "active")
    .eq("current_step", fromStep)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

const ALREADY_RAN = "This step was just run (or the enrollment changed) — refresh to see where it is now.";

export async function advanceEnrollment(enrollmentId: string): Promise<AdvanceResult> {
  const supabase = await getScopedClient();
  await requireAutomationStaffRole(supabase);
  const orgId = await currentOrgId(supabase);

  const enrollment = await loadEnrollment(supabase, enrollmentId);
  if (enrollment.status !== "active") {
    throw new CampaignAdvanceError(
      `This enrollment is ${enrollment.status}, not active — resume it first.`,
    );
  }

  // A paused campaign runs nothing. The sequence is read through the scoped
  // client, so an enrollment pointing at a sequence this org can't see is
  // refused here too rather than treated as "no steps".
  const { data: sequence, error: sequenceError } = await supabase
    .from("crm_drip_sequence")
    .select("id, active")
    .eq("id", enrollment.sequence_id)
    .maybeSingle();
  if (sequenceError) throw sequenceError;
  if (!sequence) throw new CampaignAdvanceError("This enrollment's campaign could not be found.");
  if (!sequence.active) {
    throw new CampaignAdvanceError("This campaign is paused — start it again before running its steps.");
  }

  const steps = await listSteps(enrollment.sequence_id);
  const index = enrollment.current_step;
  const completedPatch = (count: number): EnrollmentPatch => ({
    current_step: count,
    status: "completed",
    completed_at: new Date().toISOString(),
    next_step_at: null,
  });

  if (index >= steps.length) {
    if (!(await claimStep(supabase, enrollmentId, index, completedPatch(steps.length)))) {
      throw new CampaignAdvanceError(ALREADY_RAN);
    }
    return { queueItemId: null, completed: true, stepType: "wait" };
  }
  const step = steps[index];
  const lead = await loadLead(supabase, enrollment.lead_id);

  // Everything that can refuse the step is checked BEFORE the claim, so a
  // refusal never leaves the enrollment advanced past a step that didn't run.
  let emailDraft: { orgKey: string; subject: string; body: string; clientName: string; recipient: string } | null = null;
  if (step.type === "email") {
    if (!step.template_id) {
      throw new CampaignAdvanceError("This step has no email template attached — add one before running it.");
    }
    if (!lead.email) {
      throw new CampaignAdvanceError(`${leadDisplayName(lead)} has no email address to draft to.`);
    }
    const orgKey = await activeQueueOrgKey();
    if (!orgKey) {
      throw new CampaignAdvanceError(
        "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before drafting campaign emails.",
      );
    }
    const template = await loadTemplate(supabase, step.template_id);
    const rendered = renderTemplate(template, leadTemplateVars(lead));
    emailDraft = {
      orgKey,
      subject: rendered.subject,
      body: rendered.bodyText || rendered.bodyHtml,
      clientName: leadDisplayName(lead),
      recipient: lead.email,
    };
  }

  const nextIndex = index + 1;
  const completed = nextIndex >= steps.length;
  const advancePatch: EnrollmentPatch = completed
    ? completedPatch(nextIndex)
    : { current_step: nextIndex, next_step_at: addDelay(new Date(), steps[nextIndex].delay_hours) };

  if (!(await claimStep(supabase, enrollmentId, index, advancePatch))) {
    throw new CampaignAdvanceError(ALREADY_RAN);
  }

  // The step is ours. If its side effect fails, hand the step back so it can
  // be run again — conditional on nobody having moved the row since.
  const release = async () => {
    const { error } = await supabase
      .from("crm_drip_enrollment")
      .update({
        current_step: index,
        status: "active",
        completed_at: null,
        next_step_at: enrollment.next_step_at,
      })
      .eq("id", enrollmentId)
      .eq("current_step", nextIndex);
    if (error) console.error("[campaigns] failed to release a claimed step:", error);
  };

  let queueItemId: string | null = null;
  try {
    if (emailDraft) {
      const draft = await createDraft({
        orgKey: emailDraft.orgKey,
        agent: "campaign",
        type: "CLIENT_EMAIL",
        headline: emailDraft.subject || `Campaign email — ${emailDraft.clientName}`,
        draftBody: emailDraft.body,
        summary: `Sequence step ${index + 1} of ${steps.length}`,
        recipient: emailDraft.recipient,
        subject: emailDraft.subject,
        clientName: emailDraft.clientName,
      });
      queueItemId = draft.id;
    } else if (step.type === "task") {
      const config = (step.config ?? {}) as Record<string, unknown>;
      const title =
        typeof config.title === "string" && config.title.trim()
          ? config.title.trim()
          : `Follow up with ${leadDisplayName(lead)} — sequence step ${index + 1}`;
      const { error } = await supabase.from("crm_task").insert({
        org_id: orgId,
        lead_id: lead.id,
        title,
        type: "custom",
      });
      if (error) throw error;
    }
    // 'wait' and 'condition' steps have no side effect: 'wait' is purely a
    // delay (its delay_hours already governs when the NEXT step's next_step_at
    // lands), and this schema has no branch target for 'condition' — see the
    // doc comment at the top of this file / the feature's report for why that
    // is a deliberate scope cut rather than a silent no-op nobody decided on.
  } catch (err) {
    await release();
    throw err;
  }

  if (queueItemId) {
    // Best-effort audit trail on the lead's own timeline — a failure here must
    // not undo the draft that already exists in the queue. supabase-js returns
    // (not throws) a failed insert, so the error is read, not caught.
    const { error } = await supabase.from("crm_activity").insert({
      org_id: orgId,
      lead_id: lead.id,
      type: "queue_drafted",
      actor_type: "automation",
      payload: { queueItemId, sequenceId: enrollment.sequence_id, stepIndex: index, agent: "campaign" },
    });
    if (error) console.error("[campaigns] failed to log queue_drafted activity:", error);
  }

  return { queueItemId, completed, stepType: step.type };
}
