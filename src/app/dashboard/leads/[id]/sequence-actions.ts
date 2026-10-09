"use server";

import { revalidatePath } from "next/cache";
import { enrollLead, listLeadEnrollments, stopEnrollment } from "@/lib/automation/drips";
import { MANUAL_STOP_REASONS, isStopReason } from "@/lib/campaigns/stops";
import { isLane } from "@/lib/leads/lane";
import { getOrgProfile } from "@/lib/org/profile";
import { friendlyCampaignError } from "@/app/dashboard/campaigns/errors";
import { setLaneAction } from "@/app/dashboard/intake/actions";

/**
 * The lead page's lane and sequence controls (intake SOP Stages 2–3).
 *
 * Each is its own POST entry point, so each goes through a data-layer function
 * that re-checks the caller's role on every call (setLane → CAN_WRITE_LEAD;
 * enrollLead / stopEnrollment → AUTOMATION_STAFF_ROLES), and RLS sits under
 * all of them. Nothing here sends anything: "Add to nurture" enrolls, and a
 * campaign's emails still only draft into the approval queue.
 */

export type LeadSequenceState = { error?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lane select on the lead page: "" clears it. */
export async function setLeadLaneAction(_prev: LeadSequenceState, formData: FormData): Promise<LeadSequenceState> {
  const leadId = String(formData.get("leadId") ?? "");
  const raw = String(formData.get("lane") ?? "");
  if (!UUID.test(leadId)) return { error: "Missing lead." };
  if (raw && !isLane(raw)) return { error: "That isn't a lane." };
  const result = await setLaneAction(leadId, isLane(raw) ? raw : null);
  if (!result.ok) return { error: result.error };
  return { message: raw ? "Lane saved." : "Lane cleared." };
}

/** "Stop sequence" on one of the lead's enrollments, with the reason a person picked. */
export async function stopLeadSequenceAction(_prev: LeadSequenceState, formData: FormData): Promise<LeadSequenceState> {
  const leadId = String(formData.get("leadId") ?? "");
  const enrollmentId = String(formData.get("enrollmentId") ?? "");
  const reason = String(formData.get("reason") ?? "manual");
  if (!UUID.test(leadId) || !UUID.test(enrollmentId)) return { error: "Missing enrollment." };
  if (!isStopReason(reason) || !MANUAL_STOP_REASONS.includes(reason)) return { error: "Choose why this sequence is stopping." };
  try {
    // Must be one of THIS lead's enrollments (read through RLS), so a posted
    // id from another lead or firm is refused rather than stopped.
    const mine = (await listLeadEnrollments(leadId)).some((e) => e.id === enrollmentId);
    if (!mine) return { error: "That enrollment couldn't be found. Refresh and try again." };
    const after = await stopEnrollment(enrollmentId, reason);
    revalidatePath(`/dashboard/campaigns/${after.sequence_id}/`);
  } catch (err) {
    return { error: friendlyCampaignError(err, "Couldn't stop this sequence.") };
  }
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { message: "Sequence stopped." };
}

/**
 * Cold lane's next step: enroll in the firm's chosen nurture campaign. The
 * campaign id is read from the firm's own profile server-side, never from the
 * form, and enrollLead refuses a lead who is already a client.
 */
export async function addToNurtureAction(_prev: LeadSequenceState, formData: FormData): Promise<LeadSequenceState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!UUID.test(leadId)) return { error: "Missing lead." };
  try {
    const profile = await getOrgProfile();
    const sequenceId = profile?.nurture_sequence_id ?? null;
    if (!sequenceId) return { error: "No nurture campaign is chosen yet — an admin sets it in Settings → Firm profile." };
    await enrollLead(leadId, sequenceId);
    revalidatePath(`/dashboard/campaigns/${sequenceId}/`);
  } catch (err) {
    return { error: friendlyCampaignError(err, "Couldn't add this lead to nurture.") };
  }
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { message: "Added to nurture. Its emails draft into the approval queue — nothing sends on its own." };
}
