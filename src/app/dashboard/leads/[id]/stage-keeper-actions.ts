"use server";

// The three things a person can do about the Stage Keeper's work on a lead: undo a move, accept a
// suggestion, dismiss a suggestion. Each is its own POST entry point, so each re-resolves the role
// and re-reads what it acts on through the caller's own scoped client (RLS): another firm's lead,
// a missing row and a row that is not the Stage Keeper's all answer "not found". Nothing here sends
// anything to a client; it only changes where a lead sits on the board.

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_MOVE_STAGE, resolveCurrentRole } from "@/lib/pipeline/leads";
import { forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { moveLeadStageAs } from "@/lib/pipeline/move-as";
import { logActivity } from "@/lib/matters/activity";
import {
  REVIEW_SOURCE,
  decidedSuggestionIds,
  isAgentMoveRow,
  parseAgentMove,
  parseSuggestion,
  undoStateFor,
  type ActivityRow,
} from "@/lib/stage-keeper/moves";
import type { MoveEvidence } from "@/lib/stage-keeper/signals";
import { friendlyLeadWriteError, friendlyMoveStageError } from "../errors";

export type StageKeeperActionState = { ok?: boolean; error?: string };

const NOT_FOUND = "That item wasn't found. It may have been removed. Refresh the page.";
const COLUMNS = "id, lead_id, type, actor_type, created_at, payload";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/** The caller's role may move stages, re-resolved on every call. Throws a friendly LeadWriteError otherwise. */
async function requireMoveRole(supabase: ScopedClient): Promise<void> {
  const role = await resolveCurrentRole(supabase);
  if (!CAN_MOVE_STAGE.includes(role)) throw forbiddenLeadWrite(role, "move lead stage");
}

function ids(formData: FormData): { leadId: string; activityId: string } | null {
  const leadId = String(formData.get("leadId") ?? "");
  const activityId = String(formData.get("activityId") ?? "");
  return leadId && activityId ? { leadId, activityId } : null;
}

function refresh(leadId: string) {
  revalidatePath(`/dashboard/leads/${leadId}/`);
  revalidatePath("/dashboard/intake/");
}

/** The date a person's accept stamps as when the lead entered the stage: the mail's own date. A future or unusable date is ignored downstream. */
function evidenceDateOfStored(evidence: MoveEvidence | null): string | null {
  return evidence && (evidence.kind === "mail" || evidence.kind === "payment") ? evidence.at : null;
}

// ── Undo ─────────────────────────────────────────────────────────────────────

/**
 * Puts a lead back where the Stage Keeper found it, with the stage-entered date it had. Refused
 * when the viewer may not move stages, when the lead has changed stage since (a person's move
 * stands), or when this move was already undone. The move stays on the timeline and its signal
 * stays used, so the agent never re-moves the lead on it.
 */
export async function undoAgentMoveAction(_prev: StageKeeperActionState, formData: FormData): Promise<StageKeeperActionState> {
  const target = ids(formData);
  if (!target) return { error: NOT_FOUND };
  try {
    const supabase = await getScopedClient();
    await requireMoveRole(supabase);

    const { data: row, error } = await supabase.from("crm_activity").select(COLUMNS).eq("id", target.activityId).eq("lead_id", target.leadId).maybeSingle();
    if (error) throw error;
    const move = row && isAgentMoveRow(row as ActivityRow) ? parseAgentMove(row as ActivityRow) : null;
    if (!row || !move) return { error: NOT_FOUND };

    const { data: lead, error: leadErr } = await supabase.from("crm_lead").select("id, current_stage_id").eq("id", target.leadId).maybeSingle();
    if (leadErr) throw leadErr;
    if (!lead) return { error: NOT_FOUND };

    // Every stage change since (and this one): the state needs to know whether anyone moved the lead after the agent.
    const { data: later, error: laterErr } = await supabase
      .from("crm_activity")
      .select(COLUMNS)
      .eq("lead_id", target.leadId)
      .eq("type", "stage_changed")
      .gte("created_at", (row as ActivityRow).created_at);
    if (laterErr) throw laterErr;
    const state = undoStateFor([row as ActivityRow, ...((later ?? []) as ActivityRow[])], target.activityId, lead.current_stage_id);
    if (state === "undone") return { error: "This move has already been undone." };
    if (state !== "available") return { error: "This lead has been moved since, so this can't be undone here." };
    if (!move.fromStageId) return { error: "The stage this lead came from isn't recorded, so this can't be undone here." };

    await moveLeadStageAs(
      { kind: "person" },
      {
        leadId: target.leadId,
        toStageId: move.fromStageId,
        evidenceAt: move.previousStageEnteredAt,
        extraPayload: { source: "stage-keeper-undo", undoes_activity_id: target.activityId, undoes_signal_key: move.signalKey },
      },
    );
  } catch (err) {
    return { error: friendlyLeadWriteError(err, friendlyMoveStageError(err)) };
  }
  refresh(target.leadId);
  return { ok: true };
}

// ── Suggestions ──────────────────────────────────────────────────────────────

type SuggestionLookup =
  | { ok: true; suggestion: NonNullable<ReturnType<typeof parseSuggestion>> }
  | { ok: false; error: string };

/** Re-reads the lead's `ai_insight` rows through RLS: the suggestion must be there and still undecided. */
async function findPendingSuggestion(supabase: ScopedClient, leadId: string, activityId: string): Promise<SuggestionLookup> {
  const { data, error } = await supabase.from("crm_activity").select(COLUMNS).eq("lead_id", leadId).eq("type", "ai_insight");
  if (error) throw error;
  const rows = (data ?? []) as ActivityRow[];
  const suggestion = rows.map(parseSuggestion).find((s) => s?.activityId === activityId);
  if (!suggestion) return { ok: false, error: NOT_FOUND };
  if (decidedSuggestionIds(rows).has(activityId)) return { ok: false, error: "This suggestion has already been decided." };
  return { ok: true, suggestion };
}

/**
 * Accepts a suggestion: moves the lead through the person path (`moveLeadStage`, role-gated, with the
 * matter handoff when the stage is a "won" one), then logs the decision. A stale suggestion is
 * refused: the lead must still be in the stage it was suggested from, and the destination must still
 * be a stage further along.
 */
export async function acceptStageSuggestionAction(_prev: StageKeeperActionState, formData: FormData): Promise<StageKeeperActionState> {
  const target = ids(formData);
  if (!target) return { error: NOT_FOUND };
  try {
    const supabase = await getScopedClient();
    await requireMoveRole(supabase);
    const found = await findPendingSuggestion(supabase, target.leadId, target.activityId);
    if (!found.ok) return { error: found.error };
    const { suggestion } = found;
    if (!suggestion.toStageId || !suggestion.fromStageId) return { error: NOT_FOUND };

    const { data: lead, error: leadErr } = await supabase.from("crm_lead").select("id, current_stage_id").eq("id", target.leadId).maybeSingle();
    if (leadErr) throw leadErr;
    if (!lead) return { error: NOT_FOUND };
    const stale = "This suggestion is out of date, so it wasn't applied. Dismiss it.";
    if (lead.current_stage_id !== suggestion.fromStageId) return { error: stale };

    const { data: stageRows, error: stageErr } = await supabase
      .from("crm_stage")
      .select("id, order_index")
      .in("id", [suggestion.fromStageId, suggestion.toStageId]);
    if (stageErr) throw stageErr;
    const from = (stageRows ?? []).find((s) => s.id === suggestion.fromStageId);
    const to = (stageRows ?? []).find((s) => s.id === suggestion.toStageId);
    if (!from || !to || to.order_index <= from.order_index) return { error: stale };

    await moveLeadStageAs(
      { kind: "person" },
      {
        leadId: target.leadId,
        toStageId: suggestion.toStageId,
        evidenceAt: evidenceDateOfStored(suggestion.evidence),
        extraPayload: { source: "stage-keeper-accept", accepted_suggestion_id: suggestion.activityId, signal_key: suggestion.signalKey },
      },
    );

    try {
      await logActivity({
        type: "ai_insight",
        leadId: target.leadId,
        actorType: "user",
        payload: { source: REVIEW_SOURCE, suggestion_id: suggestion.activityId, signal_key: suggestion.signalKey, decision: "apply", to_stage_id: suggestion.toStageId },
        touchLead: false, // the move above already stamped the lead's last touch
      });
    } catch {
      refresh(target.leadId);
      return { error: "The lead was moved, but the suggestion couldn't be marked as done. Refresh the page." };
    }
  } catch (err) {
    return { error: friendlyLeadWriteError(err, friendlyMoveStageError(err)) };
  }
  refresh(target.leadId);
  return { ok: true };
}

/**
 * Dismisses a suggestion: logs the decision and changes nothing else. A dismissal is not contact
 * with the lead, so it does not move the lead's last touch. The signal stays used.
 */
export async function dismissStageSuggestionAction(_prev: StageKeeperActionState, formData: FormData): Promise<StageKeeperActionState> {
  const target = ids(formData);
  if (!target) return { error: NOT_FOUND };
  try {
    const supabase = await getScopedClient();
    await requireMoveRole(supabase);
    const found = await findPendingSuggestion(supabase, target.leadId, target.activityId);
    if (!found.ok) return { error: found.error };
    await logActivity({
      type: "ai_insight",
      leadId: target.leadId,
      actorType: "user",
      payload: { source: REVIEW_SOURCE, suggestion_id: found.suggestion.activityId, signal_key: found.suggestion.signalKey, decision: "dismiss", to_stage_id: found.suggestion.toStageId },
      touchLead: false,
    });
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't save this decision. Please try again.") };
  }
  refresh(target.leadId);
  return { ok: true };
}
