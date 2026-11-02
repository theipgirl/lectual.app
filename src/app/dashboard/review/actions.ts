"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_WRITE_LEAD, addLeadNote, resolveCurrentRole } from "@/lib/pipeline";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { addMatterNote } from "@/lib/matters/notes";
import { completeTask, createTask } from "@/lib/matters/tasks";
import { listMemberDirectory } from "@/lib/members/directory";
import { friendlyMatterError } from "../matters/errors";
import { isUuid, parseNextStep, parseWhatHappened } from "@/lib/review/input";

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
