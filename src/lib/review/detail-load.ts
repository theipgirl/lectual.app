import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMatterStages } from "@/lib/matters/stages";
import { listStages } from "@/lib/pipeline/stages";
import { ACTIVITY_LIMIT, clipNote, leadStageChoices, type ActivityIn, type StageOption } from "./detail";
import type { OpenRef } from "./open";

/**
 * Everything the detail panel reads about ONE record, through the caller's scoped client only. The record
 * itself is the gate: an id the scoped read cannot see is "missing", never a guess. The three optional reads
 * (open steps, recent activity, stages) each name their own failure and never read as "none".
 */
export type DetailStep = { id: string; title: string; dueDate: string | null; assigneeId: string | null };

export type DetailLoad =
  | {
      status: "ok";
      currentStageId: string | null;
      assignedTo: string | null;
      cameFrom: string | null;
      steps: { ok: true; items: DetailStep[] } | { ok: false };
      activity: { ok: true; items: ActivityIn[] } | { ok: false };
      stages: { ok: true; options: StageOption[] } | { ok: false };
    }
  | { status: "missing" }
  | { status: "unavailable" };

export async function loadReviewDetail(ref: OpenRef): Promise<DetailLoad> {
  let db;
  try {
    db = await getScopedClient();
  } catch {
    return { status: "unavailable" };
  }
  const column = ref.kind === "matter" ? "matter_id" : "lead_id";

  let currentStageId: string | null = null;
  let assignedTo: string | null = null;
  let cameFrom: string | null = null;
  try {
    if (ref.kind === "matter") {
      const { data, error } = await db.from("crm_matter").select("id, stage_id, assigned_to, referral_source").eq("id", ref.id).maybeSingle();
      if (error) throw error;
      if (!data) return { status: "missing" };
      currentStageId = data.stage_id;
      assignedTo = data.assigned_to;
      cameFrom = data.referral_source?.trim() || null;
    } else {
      const { data, error } = await db.from("crm_lead").select("id, current_stage_id, assigned_to, referral_source").eq("id", ref.id).maybeSingle();
      if (error) throw error;
      if (!data) return { status: "missing" };
      currentStageId = data.current_stage_id;
      assignedTo = data.assigned_to;
      cameFrom = data.referral_source?.trim() || null;
    }
  } catch {
    return { status: "unavailable" };
  }

  const [stepsS, activityS, stagesS] = await Promise.allSettled([
    db.from("crm_task").select("id, title, due_at, assignee_id, created_at").eq("status", "open").eq(column, ref.id).order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }),
    db.from("crm_activity").select("id, type, actor_type, created_at, payload").eq(column, ref.id).order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT),
    ref.kind === "matter" ? listMatterStages().then((s) => s.map((x) => ({ id: x.id, name: x.label }))) : listStages().then((s) => leadStageChoices(s)),
  ]);

  const steps: Extract<DetailLoad, { status: "ok" }>["steps"] =
    stepsS.status === "fulfilled" && !stepsS.value.error
      ? { ok: true, items: (stepsS.value.data ?? []).map((t) => ({ id: t.id, title: t.title, dueDate: t.due_at ? t.due_at.slice(0, 10) : null, assigneeId: t.assignee_id })) }
      : { ok: false };
  const activity: Extract<DetailLoad, { status: "ok" }>["activity"] =
    activityS.status === "fulfilled" && !activityS.value.error ? { ok: true, items: (activityS.value.data ?? []) as ActivityIn[] } : { ok: false };
  const stages: Extract<DetailLoad, { status: "ok" }>["stages"] = stagesS.status === "fulfilled" ? { ok: true, options: stagesS.value } : { ok: false };

  return { status: "ok", currentStageId, assignedTo, cameFrom, steps, activity, stages };
}

export type LatestNote = { status: "ok"; text: string | null } | { status: "unavailable" };

/** The newest plain note on the record, clipped, for the Cards view. A failed read says so; it is never "no note". */
export async function loadLatestNote(ref: OpenRef): Promise<LatestNote> {
  try {
    const db = await getScopedClient();
    const column = ref.kind === "matter" ? "matter_id" : "lead_id";
    const { data, error } = await db.from("crm_activity").select("payload").eq(column, ref.id).eq("type", "note").order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    const p = (data?.[0]?.payload ?? null) as Record<string, unknown> | null;
    const raw = p && [p.note, p.body, p.text].find((v) => typeof v === "string" && v.trim());
    return { status: "ok", text: typeof raw === "string" ? clipNote(raw) : null };
  } catch {
    return { status: "unavailable" };
  }
}
