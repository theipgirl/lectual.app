import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import type { MoveEvidence, SignalId } from "@/lib/stage-keeper/signals";
import { usableEvidenceDate } from "./evidence-date";
import type { Lead } from "./leads";

/**
 * The one shared place a lead's stage changes, for a person and for the Stage Keeper.
 *
 * A PERSON goes through the existing `moveLeadStage` unchanged: the signed-in caller's scoped
 * client, `CAN_MOVE_STAGE`, the matter handoff for a "won" stage, the automation rules. This
 * module only adds the second actor.
 *
 * The AGENT has no session, so it is handed the service-role client together with the
 * org id it must fence every statement with (the id came from the firm's own database row,
 * never from a request). On top of the fence it refuses, on its own and whatever the caller
 * decided:
 *   - a destination in another firm (the stage is read with the org filter, so it is simply absent)
 *   - a destination that is not an ordinary `open` stage (never won, lost or nurture)
 *   - a destination that is not strictly later in the pipeline than where the lead is
 *   - a lead that is no longer in the stage the decision was made from (a person's move in
 *     between wins, and the agent writes nothing)
 *
 * It does not open a matter, stop a sequence or run an automation rule: those run through the
 * signed-in client, which the cron does not have, and it cannot reach a "won" stage anyway.
 * It never touches `lane`, `lane_set_by` or `lane_set_at`.
 */

export type PersonActor = { kind: "person" };
export type AgentActor = { kind: "agent"; agent: "stage-keeper"; admin: SupabaseClient; orgId: string };
export type MoveActor = PersonActor | AgentActor;

export type PersonMove = {
  leadId: string;
  toStageId: string;
  /** A better date for when the lead really entered the stage. Unusable or future dates are ignored. */
  evidenceAt?: string | null;
  /** Fields added to the same `stage_changed` row (an Undo names the move it answers). */
  extraPayload?: Record<string, unknown>;
};

export type AgentMove = {
  leadId: string;
  /** The stage the decision was made from. The update only lands if the lead is still there. */
  fromStageId: string;
  toStageId: string;
  signalKey: string;
  signalId: SignalId;
  evidence: MoveEvidence;
  /** The evidence date; null (or unusable, or in the future) means "now". */
  evidenceAt: string | null;
  now?: number;
};

export type AgentMoveOutcome =
  | { ok: true; activityId: string | null; stageEnteredAt: string; previousStageEnteredAt: string | null }
  | { ok: false; reason: "refused" | "not-found" | "stale" | "error" };

export async function moveLeadStageAs(actor: PersonActor, move: PersonMove): Promise<{ ok: true; lead: Lead }>;
export async function moveLeadStageAs(actor: AgentActor, move: AgentMove): Promise<AgentMoveOutcome>;
export async function moveLeadStageAs(actor: MoveActor, move: PersonMove | AgentMove): Promise<{ ok: true; lead: Lead } | AgentMoveOutcome> {
  if (actor.kind === "person") {
    const m = move as PersonMove;
    // Loaded on demand so the agent runner's module graph does not pull in the whole signed-in pipeline.
    const { moveLeadStage } = await import("./leads");
    const lead = await moveLeadStage(m.leadId, m.toStageId, m.evidenceAt ?? null, m.extraPayload);
    return { ok: true, lead };
  }
  return moveAsAgent(actor, move as AgentMove);
}

type StageRow = { id: string; name: string; category: string; order_index: number };

async function moveAsAgent(actor: AgentActor, move: AgentMove): Promise<AgentMoveOutcome> {
  const { admin, orgId } = actor;
  if (move.fromStageId === move.toStageId) return { ok: false, reason: "refused" };

  const { data: stageData, error: stageErr } = await admin
    .from("crm_stage")
    .select("id, name, category, order_index")
    .eq("org_id", orgId)
    .in("id", [move.fromStageId, move.toStageId]);
  if (stageErr) return { ok: false, reason: "error" };
  const stages = (stageData ?? []) as StageRow[];
  const from = stages.find((s) => s.id === move.fromStageId);
  const to = stages.find((s) => s.id === move.toStageId);
  if (!from || !to) return { ok: false, reason: "refused" };
  if (to.category !== "open" || to.order_index <= from.order_index) return { ok: false, reason: "refused" };

  const { data: leadData, error: leadErr } = await admin
    .from("crm_lead")
    .select("id, current_stage_id, stage_entered_at")
    .eq("id", move.leadId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (leadErr) return { ok: false, reason: "error" };
  const lead = leadData as { id: string; current_stage_id: string; stage_entered_at: string | null } | null;
  if (!lead) return { ok: false, reason: "not-found" };
  if (lead.current_stage_id !== move.fromStageId) return { ok: false, reason: "stale" };

  const nowMs = move.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const evidenceDate = usableEvidenceDate(move.evidenceAt, nowMs);
  const enteredAt = evidenceDate ?? nowIso;
  const previousStageEnteredAt = lead.stage_entered_at ?? null;

  // Conditional on the stage the decision was made from: a person who moved the lead a moment
  // ago wins, and this matches no row.
  const { data: updated, error: updateErr } = await admin
    .from("crm_lead")
    .update({ current_stage_id: move.toStageId, stage_entered_at: enteredAt, last_activity_at: nowIso })
    .eq("id", move.leadId)
    .eq("org_id", orgId)
    .eq("current_stage_id", move.fromStageId)
    .select("id");
  if (updateErr) return { ok: false, reason: "error" };
  if (!Array.isArray(updated) || updated.length === 0) return { ok: false, reason: "stale" };

  const { data: inserted, error: insertErr } = await admin
    .from("crm_activity")
    .insert({
      org_id: orgId,
      lead_id: move.leadId,
      type: "stage_changed",
      actor_id: null,
      actor_type: "ai",
      payload: {
        actor: AGENT_ACTOR,
        from_stage: from.name,
        to_stage: to.name,
        from_stage_id: from.id,
        to_stage_id: to.id,
        signal_key: move.signalKey,
        signal: move.signalId,
        previous_stage_entered_at: previousStageEnteredAt,
        evidence: move.evidence,
        ...(evidenceDate ? { evidence_at: evidenceDate } : {}),
      },
    })
    .select("id")
    .single();

  if (insertErr) {
    // The timeline is append-only, so there is nothing to undo there. A move nobody can see is
    // worse than no move, so the lead goes back (only if it is still where this call put it).
    await admin
      .from("crm_lead")
      .update({ current_stage_id: move.fromStageId, stage_entered_at: previousStageEnteredAt })
      .eq("id", move.leadId)
      .eq("org_id", orgId)
      .eq("current_stage_id", move.toStageId);
    return { ok: false, reason: "error" };
  }
  const row = (Array.isArray(inserted) ? inserted[0] : inserted) as { id?: string } | null;
  return { ok: true, activityId: row?.id ?? null, stageEnteredAt: enteredAt, previousStageEnteredAt };
}
