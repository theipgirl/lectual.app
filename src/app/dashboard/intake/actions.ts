"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { assignLead, moveLeadStage } from "@/lib/pipeline";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "@/lib/pipeline/leads";
import { forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { setLane, setReferralSource } from "@/lib/intake/leads";
import { isLane, type Lane } from "@/lib/leads/lane";
import { isReferralSource, type ReferralSource } from "@/lib/intake";
// Pure helpers, shared with the pipeline page rather than re-implemented:
// only a LeadWriteError's message is ever allowed through to a firm user's
// screen, so a raw RLS/Postgres string can't leak from this surface either.
import {
  friendlyLeadWriteError,
  friendlyMoveStageError,
} from "@/app/dashboard/leads/errors";

/**
 * Server actions for /intake (blueprint §11 — the same three writes Phase 1's
 * /dashboard/intake had, re-homed with the page). Each one is a thin wrapper:
 * the real role gate and the write live in the data layer, and this file's
 * whole job is to turn a refusal into `{ ok: false, error }` for the optimistic
 * UI instead of an unhandled throw — the same contract as pipeline/actions.ts.
 *
 * Nothing here sends email, touches Lawmatics, or reaches a client. The
 * approval queue remains the only path by which anything leaves the firm.
 */

export type IntakeActionResult = { ok: true } | { ok: false; error: string };

/**
 * Re-checks the caller's role for the one write whose data-layer function does
 * NOT self-gate (assignLead). Same list and same "resolve every time, never
 * cache" rule as the lead-detail page's requireLeadWriteRole.
 */
async function requireIntakeWriteRole(): Promise<void> {
  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "edit leads");
  }
}

/**
 * Inline "who owns the next response" reassign (§1.9), and the drop target of
 * the board-by-owner drag. Empty id = unassign.
 *
 * Reassigning tells nobody: there is no notification path in this build, and
 * the top bar's copy says "Drag a card to reassign" rather than claiming the
 * person is told. (A notification centre is §13.3, unbuilt.)
 */
export async function assignLeadAction(
  leadId: string,
  userId: string | null,
): Promise<IntakeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };

  try {
    await requireIntakeWriteRole();
    await assignLead(leadId, userId || null);
  } catch (err) {
    return {
      ok: false,
      error: friendlyLeadWriteError(err, "Couldn't reassign this lead."),
    };
  }

  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
}

/**
 * Moves a lead to another stage — the board-by-stage drop, and the stage menu
 * that is its keyboard equivalent. Delegates to the same role-gated
 * moveLeadStage the pipeline board uses (CAN_MOVE_STAGE is narrower than
 * CAN_WRITE_LEAD — a paralegal is refused here and that is intended).
 */
export async function moveStageAction(
  leadId: string,
  stageId: string,
): Promise<IntakeActionResult> {
  if (!leadId || !stageId) return { ok: false, error: "Missing lead or stage." };

  try {
    await moveLeadStage(leadId, stageId);
  } catch (err) {
    return { ok: false, error: friendlyMoveStageError(err) };
  }

  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
}

/**
 * Sets or clears a lead's temperature, which is the routing lane — the
 * person's call, over what the activity rules and triage suggest (intake SOP
 * Stage 2). It is the only temperature write on this surface. The data layer
 * re-checks the role, and the database stamps who and when from the session.
 */
export async function setLaneAction(leadId: string, lane: Lane | null): Promise<IntakeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };
  if (lane !== null && !isLane(lane)) return { ok: false, error: "That isn't a lane." };

  try {
    await setLane(leadId, lane);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't set this lead's lane.") };
  }

  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
}

/**
 * Sets or clears a lead's referral source from the card or the table row. The
 * value is checked against REFERRAL_SOURCES here (it arrives as an unchecked
 * string over the action boundary) and again in the data layer, which also
 * re-checks the caller's role and writes the timeline row.
 */
export async function setSourceAction(
  leadId: string,
  source: ReferralSource | null,
): Promise<IntakeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };
  if (source !== null && !isReferralSource(source)) {
    return { ok: false, error: "That isn't one of the sources." };
  }

  try {
    await setReferralSource(leadId, source);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't update this lead's source.") };
  }

  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
}
