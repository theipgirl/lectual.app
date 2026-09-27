"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { assignLead, moveLeadStage } from "@/lib/pipeline";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "@/lib/pipeline/leads";
import { forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { setTemperature } from "@/lib/intake/leads";
import type { Temperature } from "@/lib/intake";
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

const TEMPERATURES: readonly Temperature[] = ["hot", "warm", "cold"];

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

/** Sets or clears a lead's hot/warm/cold override (§4.3). */
export async function setTemperatureAction(
  leadId: string,
  level: Temperature | null,
): Promise<IntakeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };
  if (level !== null && !TEMPERATURES.includes(level)) {
    return { ok: false, error: "That isn't a temperature." };
  }

  try {
    await setTemperature(leadId, level);
  } catch (err) {
    return {
      ok: false,
      error: friendlyLeadWriteError(err, "Couldn't update this lead's temperature."),
    };
  }

  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
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
