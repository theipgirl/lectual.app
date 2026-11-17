"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { assignLead, moveLeadStage } from "@/lib/pipeline";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { compareRoleRules, loadCompare, type CompareResult } from "@/lib/intake/compare-load";
import { LEADS_COMPARE_FAILED } from "@/lib/ui/words";
import { canMergeLeads } from "@/lib/leads/merge";
import { mergeAvailable } from "@/lib/leads/live";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD, resolveCurrentRole } from "@/lib/pipeline/leads";
import { runBulkMove, type BulkMoveResult } from "@/lib/pipeline/bulk-move";
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
 * "Move to..." for the cards selected on the board: up to 200 leads to one non-`won` stage, each through the same
 * `moveLeadStage` the drag uses (so each is logged on its own timeline). The rules, and the per-lead result, are in
 * `runBulkMove`; this only wires the real reads. Everything is through the caller's scoped client (RLS is the tenant
 * boundary) and the role is re-resolved on this call.
 */
export async function bulkMoveStageAction(leadIds: string[], stageId: string): Promise<BulkMoveResult> {
  const result = await runBulkMove(
    { leadIds, stageId },
    {
      canMove: async () => {
        const supabase = await getScopedClient();
        return CAN_MOVE_STAGE.includes(await resolveCurrentRole(supabase));
      },
      readStage: async (id) => {
        const supabase = await getScopedClient();
        const { data, error } = await supabase.from("crm_stage").select("id, category").eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? { id: data.id, category: String(data.category) } : null;
      },
      readLeads: async (ids) => {
        const supabase = await getScopedClient();
        // live-guard: bulk move re-reads the ticked (live) leads by id and moves each through moveLeadStage (refusal mapped); the compare panel reads two leads by id
        const { data, error } = await supabase.from("crm_lead").select("id, current_stage_id").in("id", ids);
        if (error) throw error;
        return data ?? [];
      },
      move: async (leadId, id) => {
        await moveLeadStage(leadId, id);
      },
      explain: friendlyMoveStageError,
    },
  );
  if (result.ok && result.moved.length > 0) {
    revalidatePath("/dashboard/intake/");
    for (const leadId of result.moved) revalidatePath(`/dashboard/leads/${leadId}`);
  }
  return result;
}

/**
 * Sets or clears a lead's temperature, which is the routing lane — the
 * person's call, over what the activity rules and triage suggest (intake SOP
 * Stage 2). It is the only temperature write on this surface. The data layer
 * re-checks the role, and the database stamps who and when from the session.
 */
export async function setLaneAction(leadId: string, lane: Lane | null): Promise<IntakeActionResult> {
  if (!leadId) return { ok: false, error: "Missing lead." };
  if (lane !== null && !isLane(lane)) return { ok: false, error: "That isn't a temperature." };

  try {
    await setLane(leadId, lane);
  } catch (err) {
    return { ok: false, error: friendlyLeadWriteError(err, "Couldn't set this lead's temperature.") };
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

/**
 * The "Possible duplicate" compare panel: two leads side by side, with what is on file for each. READ ONLY: nothing is
 * merged, moved or written. Everything goes through the caller's scoped client (RLS is the tenant boundary, so another
 * firm's id reads as "gone"); each count is its own read and a failed one says so. Proposals are counted only for a firm that
 * has the Proposals feature (the module list that can't be read counts as off).
 */
export async function loadCompareAction(leadId: string, otherId: string): Promise<CompareResult> {
  try {
    const db = await getScopedClient();
    // The role is resolved first: a caller with no resolvable role reads nothing and gets the one fixed sentence.
    const role = await resolveCurrentRole(db);
    const rules = compareRoleRules(role);
    // The Merge link (M5): only for the roles that may merge, and only where lectual 0107 is there. Hidden otherwise.
    const merge = canMergeLeads(role) && (await mergeAvailable(db));
    const result = await loadCompare(leadId, otherId, {
      readLead: async (id) => {
        const { data, error } = await db
          // live-guard: bulk move re-reads the ticked (live) leads by id and moves each through moveLeadStage (refusal mapped); the compare panel reads two leads by id
          .from("crm_lead")
          .select("id, first_name, last_name, business_name, mark_text, email, referral_source, created_at, current_stage_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ?? null;
      },
      readStageName: async (stageId) => {
        const { data, error } = await db.from("crm_stage").select("name").eq("id", stageId).maybeSingle();
        if (error) throw error;
        return data?.name ?? null;
      },
      count: async (table, id) => {
        // `client_proposal` is not in the generated types (the proposals store casts the same way), so the count is typed here.
        const counter = db as unknown as { from: (t: string) => { select: (c: string, o: { count: "exact"; head: true }) => { eq: (c: string, v: string) => PromiseLike<{ count: number | null; error: unknown }> } } };
        const { count, error } = await counter.from(table).select("id", { count: "exact", head: true }).eq("lead_id", id);
        if (error || count === null || count === undefined) throw new Error("count");
        return count;
      },
      // Proposals are counted only for the roles that read them (the proposals roles of lectual 0089, PROPOSAL_STAFF_WRITE_ROLES) in a firm
      // that has the feature. Any other role gets no Proposals row at all, never a "0". The count is by lead_id only: a proposal filed on the
      // lead's matter but not on the lead is not counted.
      // viewer and social_media see no email address in the comparison (it is left out, not blanked).
      showEmail: rules.showEmail,
      now: new Date(),
      timeZone: await getFirmTimeZone().catch(() => "UTC"),
      proposalsOn: async () => rules.mayCountProposals && (await orgHasModule("proposals")),
    });
    return result.ok && merge ? { ok: true, data: { ...result.data, merge: true } } : result;
  } catch {
    return { ok: false, error: LEADS_COMPARE_FAILED };
  }
}
