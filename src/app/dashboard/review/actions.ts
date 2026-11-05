"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD, addLeadNote, moveLeadStage, resolveCurrentRole } from "@/lib/pipeline";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { addMatterNote } from "@/lib/matters/notes";
import { completeTask, createTask } from "@/lib/matters/tasks";
import { listMemberDirectory } from "@/lib/members/directory";
import { friendlyMatterError } from "../matters/errors";
import { isUuid, parseCloseLead, parseNextStep, parseWhatHappened } from "@/lib/review/input";

export type ReviewActionState = { error?: string; saved?: boolean };

const NO_PERMISSION = "You don't have permission to change this. Ask an attorney or an admin.";
const NOT_FOUND = "That record couldn't be found. It may have been removed.";

/** Re-resolved on every call (never cached). The two write lists are the same list; RLS is the real boundary. */
async function canWrite(kind: "matter" | "lead"): Promise<boolean> {
  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  return (kind === "matter" ? MATTER_WRITE_ROLES : CAN_WRITE_LEAD).includes(role);
}

/** The record must be visible to the caller's scoped client; another firm's id reads as missing. */
async function recordVisible(kind: "matter" | "lead", id: string): Promise<boolean> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from(kind === "matter" ? "crm_matter" : "crm_lead").select("id").eq("id", id).maybeSingle();
  if (error) throw error;
  return !!data;
}

function refresh() {
  revalidatePath("/dashboard/review/");
  revalidatePath("/dashboard/");
}

/** Adds the next step as an ordinary task on the matter or lead (the same createTask the matter page uses). */
export async function setNextStepAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const parsed = parseNextStep(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { kind, id, title, dueAt, assigneeId } = parsed.value;
  try {
    if (!(await canWrite(kind))) return { error: NO_PERMISSION };
    if (!(await recordVisible(kind, id))) return { error: NOT_FOUND };
    if (assigneeId) {
      let members;
      try {
        members = await listMemberDirectory();
      } catch {
        return { error: "Couldn't check the team list right now, so nothing was saved. Try again." };
      }
      if (!members.some((m) => m.userId === assigneeId)) return { error: "That person isn't a member of your firm." };
    }
    await createTask({
      title,
      ...(kind === "matter" ? { matterId: id } : { leadId: id }),
      dueAt: dueAt ?? undefined,
      assigneeId: assigneeId ?? undefined,
    });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save the next step.") };
  }
  refresh();
  return { saved: true };
}

/** Marks the next step done. The task is read through the scoped client first. */
export async function completeNextStepAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  if (!isUuid(taskId)) return { error: NOT_FOUND };
  try {
    const supabase = await getScopedClient();
    const role = await resolveCurrentRole(supabase);
    if (!MATTER_WRITE_ROLES.includes(role)) return { error: NO_PERMISSION };
    const { data, error } = await supabase.from("crm_task").select("id, status").eq("id", taskId).maybeSingle();
    if (error) throw error;
    if (!data) return { error: NOT_FOUND };
    if (data.status === "open") await completeTask(taskId);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't mark this done.") };
  }
  refresh();
  return { saved: true };
}

/** A short note on the timeline (the existing note paths); it counts as last contact. Nothing is sent. */
export async function logWhatHappenedAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const parsed = parseWhatHappened(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { kind, id, body } = parsed.value;
  try {
    if (!(await canWrite(kind))) return { error: NO_PERMISSION };
    if (kind === "matter") await addMatterNote(id, { kind: "note", body });
    else await addLeadNote(id, { kind: "note", body });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save this note.") };
  }
  refresh();
  return { saved: true };
}

/**
 * Lost / Nurture on a LEAD: a person's explicit choice, through the same `moveLeadStage` a drag uses (it logs
 * `stage_changed`). Role, lead and target stage are all re-read here; only a `lost` or `nurture` stage is accepted,
 * whatever the browser posted. Tasks are left alone. The optional reason becomes a plain lead note.
 */
export async function closeLeadAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const parsed = parseCloseLead(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { id, stageId, reason } = parsed.value;
  let stageName: string;
  try {
    const supabase = await getScopedClient();
    const role = await resolveCurrentRole(supabase);
    if (!CAN_MOVE_STAGE.includes(role) || !CAN_WRITE_LEAD.includes(role)) return { error: NO_PERMISSION };
    const { data: lead, error: leadErr } = await supabase.from("crm_lead").select("id, current_stage_id").eq("id", id).maybeSingle();
    if (leadErr) throw leadErr;
    if (!lead) return { error: NOT_FOUND };
    const { data: stage, error: stageErr } = await supabase.from("crm_stage").select("id, name, category").eq("id", stageId).maybeSingle();
    if (stageErr) throw stageErr;
    if (!stage || (stage.category !== "lost" && stage.category !== "nurture")) return { error: "Choose one of your Lost or Nurture stages." };
    if (lead.current_stage_id === stage.id) return { error: "This lead is already in that stage." };
    stageName = stage.name;
    await moveLeadStage(id, stage.id);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't move this lead.") };
  }
  let noteSaved = true;
  if (reason) {
    try {
      await addLeadNote(id, { kind: "note", body: `Moved to ${stageName}: ${reason}` });
    } catch {
      noteSaved = false;
    }
  }
  refresh();
  return noteSaved ? { saved: true } : { saved: true, error: "The lead was moved, but the reason couldn't be saved as a note." };
}
