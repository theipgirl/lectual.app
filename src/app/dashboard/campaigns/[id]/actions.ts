"use server";

import { revalidatePath } from "next/cache";
import {
  addStep,
  deleteStep,
  enrollLead,
  getSequence,
  listEnrollments,
  listSteps,
  listTemplates,
  setEnrollmentStatus,
  toggleSequenceActive,
  updateSequenceDetails,
  type DripStepType,
} from "@/lib/automation/drips";
import { advanceEnrollment } from "@/lib/campaigns/advance";
import { DRIP_STEP_TYPES } from "@/lib/campaigns/steps";
import { friendlyCampaignError, type ActionState } from "../errors";

/**
 * The campaign BUILDER's own write surface — everything that mutates ONE
 * existing sequence (details, active flag, its steps, its enrollments).
 * Sequence CREATION lives one level up, in `../actions.ts` (same split as
 * quotes' `[id]/actions.ts`).
 *
 * Every function below calls straight into `@/lib/automation/drips.ts` or
 * `@/lib/campaigns/advance.ts`, which re-check the caller's role on EVERY
 * call (`requireAutomationAdminRole` / `requireAutomationStaffRole`) — this
 * file's own job is only to read the form and turn a thrown Error into a
 * readable ActionState. Nothing here is itself the authorization boundary.
 */

function campaignPath(sequenceId: string): string {
  return `/dashboard/campaigns/${sequenceId}/`;
}

function revalidateCampaign(sequenceId: string): void {
  revalidatePath(campaignPath(sequenceId));
  revalidatePath("/dashboard/campaigns/");
}

function errorState(err: unknown, fallback: string): ActionState {
  return { error: friendlyCampaignError(err, fallback) };
}

/**
 * The ids below arrive in a form, so each one is re-read through the scoped
 * client before it is written anywhere. The drip tables' foreign keys are
 * single-column (`sequence_id`, `template_id` reference the row's id only, not
 * `(id, org_id)`), so RLS's with-check on OUR org_id would happily accept a
 * row pointing at ANOTHER firm's sequence or template. A read that RLS hides
 * refuses it here instead.
 */
async function requireVisibleSequence(sequenceId: string): Promise<void> {
  if (!(await getSequence(sequenceId))) throw new Error("That campaign couldn't be found. Refresh and try again.");
}

function isStepType(value: unknown): value is DripStepType {
  return typeof value === "string" && (DRIP_STEP_TYPES as readonly string[]).includes(value);
}

// ── Sequence details ─────────────────────────────────────────────────────

export async function updateSequenceDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!sequenceId) return { error: "Missing campaign." };
  if (!name) return { error: "Enter a name for this campaign." };

  try {
    await updateSequenceDetails(sequenceId, { name, description: description || undefined });
  } catch (err) {
    return errorState(err, "Couldn't save these details.");
  }
  revalidateCampaign(sequenceId);
  return { saved: true };
}

export async function toggleSequenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const nextActive = formData.get("nextActive") === "true";
  if (!sequenceId) return { error: "Missing campaign." };

  try {
    await toggleSequenceActive(sequenceId, nextActive);
  } catch (err) {
    return errorState(err, "Couldn't update this campaign.");
  }
  revalidateCampaign(sequenceId);
  return {};
}

// ── Steps ────────────────────────────────────────────────────────────────

/**
 * Appends a step. `order_index` is computed here as one past the sequence's
 * CURRENT highest index (re-read fresh, never taken from the form) — that is
 * what `unique(sequence_id, order_index)` requires. Not the step COUNT:
 * removing a middle step leaves a gap, and count would then collide with the
 * last step's index.
 */
export async function addStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const typeRaw = String(formData.get("type") ?? "");
  const delayRaw = String(formData.get("delayHours") ?? "0").trim();
  const templateId = String(formData.get("templateId") ?? "").trim() || null;
  const taskTitle = String(formData.get("taskTitle") ?? "").trim();
  if (!sequenceId) return { error: "Missing campaign." };
  if (!isStepType(typeRaw)) return { error: "Choose a step type." };

  const delayHours = Number(delayRaw);
  if (!Number.isFinite(delayHours) || delayHours < 0) return { error: "Delay must be zero or a positive number of hours." };
  if (typeRaw === "email" && !templateId) return { error: "Choose an email template for this step." };

  try {
    await requireVisibleSequence(sequenceId);
    if (typeRaw === "email" && !(await listTemplates()).some((t) => t.id === templateId)) {
      return { error: "That template couldn't be found. Refresh and try again." };
    }
    const existing = await listSteps(sequenceId);
    const nextIndex = existing.reduce((max, step) => Math.max(max, step.order_index + 1), 0);
    await addStep(sequenceId, {
      orderIndex: nextIndex,
      type: typeRaw,
      delayHours: Math.round(delayHours),
      templateId: typeRaw === "email" ? templateId : null,
      config: typeRaw === "task" && taskTitle ? { title: taskTitle } : {},
    });
  } catch (err) {
    return errorState(err, "Couldn't add this step.");
  }
  revalidateCampaign(sequenceId);
  return {};
}

export async function deleteStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const stepId = String(formData.get("stepId") ?? "");
  if (!sequenceId || !stepId) return { error: "Missing step." };

  try {
    await deleteStep(stepId);
  } catch (err) {
    return errorState(err, "Couldn't remove this step.");
  }
  revalidateCampaign(sequenceId);
  return {};
}

// ── Enrollments ──────────────────────────────────────────────────────────

export async function enrollLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  if (!sequenceId) return { error: "Missing campaign." };
  if (!leadId) return { error: "Choose a lead to enroll." };

  try {
    await requireVisibleSequence(sequenceId);
    await enrollLead(leadId, sequenceId);
  } catch (err) {
    return errorState(err, "Couldn't enroll this lead.");
  }
  revalidateCampaign(sequenceId);
  return {};
}

export async function pauseEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatusAction(formData, "paused");
}

export async function resumeEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatusAction(formData, "active");
}

export async function cancelEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return setStatusAction(formData, "cancelled");
}

async function setStatusAction(formData: FormData, status: "active" | "paused" | "cancelled"): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  if (!sequenceId || !enrollmentId) return { error: "Missing enrollment." };

  try {
    // Only the transitions the page offers: pause/cancel an active one,
    // resume/cancel a paused one. A completed or cancelled enrollment is
    // final — a hand-posted "resume" must not revive it.
    const allowedFrom = status === "active" ? ["paused"] : status === "paused" ? ["active"] : ["active", "paused"];
    const current = (await listEnrollments({ sequenceId })).find((e) => e.id === enrollmentId);
    if (!current) return { error: "That enrollment couldn't be found. Refresh and try again." };
    if (!allowedFrom.includes(current.status)) {
      return { error: `This enrollment is ${current.status} — refresh to see where it is now.` };
    }
    await setEnrollmentStatus(enrollmentId, status);
  } catch (err) {
    return errorState(err, "Couldn't update this enrollment.");
  }
  revalidateCampaign(sequenceId);
  return {};
}

/**
 * Runs one enrollment's next step. An `email` step drafts into the approval
 * queue (never sends — see @/lib/campaigns/advance.ts's doc comment); the
 * result names whether it drafted something, so the page can say "Drafted —
 * open the queue to review it" rather than a bare "done".
 */
export async function advanceEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sequenceId = String(formData.get("sequenceId") ?? "");
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  if (!sequenceId || !enrollmentId) return { error: "Missing enrollment." };

  try {
    const result = await advanceEnrollment(enrollmentId);
    revalidateCampaign(sequenceId);
    if (result.queueItemId) {
      return { saved: true, message: "Drafted into the approval queue — nothing sent yet." };
    }
    if (result.stepType === "task") {
      return { saved: true, message: "Task created for this lead." };
    }
    return { saved: true, message: result.completed ? "Sequence completed for this lead." : "Advanced to the next step." };
  } catch (err) {
    return errorState(err, "Couldn't run this step.");
  }
}
