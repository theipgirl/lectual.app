"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD, addLeadNote, assignLead, moveLeadStage, resolveCurrentRole } from "@/lib/pipeline";
import { MATTER_WRITE_ROLES, assignMatterOwner, updateMatterHeader } from "@/lib/matters/matters";
import { setReferralSource } from "@/lib/intake/leads";
import { isReferralSource } from "@/lib/intake/referral-source";
import { updateMatterStage } from "@/lib/matters/stages";
import { getFirmTimeZone } from "@/lib/org/profile";
import { addMatterNote } from "@/lib/matters/notes";
import { completeTask, createTask, updateTask } from "@/lib/matters/tasks";
import { listMemberDirectory } from "@/lib/members/directory";
import { friendlyMatterError } from "../matters/errors";
import { isUuid, parseCloseLead, parseKind, parseNextStep, parseWhatHappened } from "@/lib/review/input";
import { civilDateIn } from "@/lib/review/build";
import { isSnoozeChoice, snoozeDate } from "@/lib/review/snooze";

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

/** The open task behind a step form, read through the scoped client: another firm's id reads as missing. */
async function openTask(taskId: string): Promise<"missing" | "closed" | "open"> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_task").select("id, status").eq("id", taskId).maybeSingle();
  if (error) throw error;
  if (!data) return "missing";
  return data.status === "open" ? "open" : "closed";
}

/**
 * Edits the existing next step: title, due date and/or assignee (only the fields the form posts). It goes through
 * `updateTask`, the same call the matter page's task editor uses, which re-checks the role, validates and logs.
 */
export async function updateNextStepAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  if (!isUuid(taskId)) return { error: NOT_FOUND };
  const assignee = String(formData.get("assigneeId") ?? "").trim();
  if (formData.has("assigneeId") && assignee && !isUuid(assignee)) return { error: "Choose someone from your team." };
  try {
    const supabase = await getScopedClient();
    const role = await resolveCurrentRole(supabase);
    if (!MATTER_WRITE_ROLES.includes(role)) return { error: NO_PERMISSION };
    const state = await openTask(taskId);
    if (state === "missing") return { error: NOT_FOUND };
    if (state === "closed") return { error: "That step is already done." };
    await updateTask(taskId, {
      ...(formData.has("title") ? { title: String(formData.get("title") ?? "") } : {}),
      ...(formData.has("dueAt") ? { dueAt: String(formData.get("dueAt") ?? "") } : {}),
      ...(formData.has("assigneeId") ? { assigneeId: assignee } : {}),
    });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save the next step.") };
  }
  refresh();
  return { saved: true };
}

/** Snooze: only the due date moves, to a date worked out here from the firm's own calendar day. */
export async function snoozeNextStepAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  const when = formData.get("when");
  if (!isUuid(taskId)) return { error: NOT_FOUND };
  if (!isSnoozeChoice(when)) return { error: "Choose when to look at this again." };
  try {
    const supabase = await getScopedClient();
    const role = await resolveCurrentRole(supabase);
    if (!MATTER_WRITE_ROLES.includes(role)) return { error: NO_PERMISSION };
    const state = await openTask(taskId);
    if (state === "missing") return { error: NOT_FOUND };
    if (state === "closed") return { error: "That step is already done." };
    let zone = "America/New_York";
    try {
      zone = await getFirmTimeZone();
    } catch {
      // Same fallback the review page uses when the firm's zone can't be read.
    }
    await updateTask(taskId, { dueAt: snoozeDate(when, civilDateIn(new Date(), zone)) });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't snooze this step.") };
  }
  refresh();
  return { saved: true };
}

/** Another firm's member ids are refused; an unreadable directory refuses the change rather than allowing it unchecked. */
async function assigneeIsMember(userId: string): Promise<"yes" | "no" | "unknown"> {
  try {
    return (await listMemberDirectory()).some((m) => m.userId === userId) ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

/**
 * Move stage from the panel. A matter goes to a stage on the firm's docket (`updateMatterStage`, the matter page's own
 * move). A lead goes through `moveLeadStage` (the board's move), only to an open, lost or nurture stage: never `won`,
 * because that move runs the matter handoff. Role, record and target stage are all re-read here.
 */
export async function moveStageAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const kind = parseKind(formData.get("kind"));
  const id = String(formData.get("id") ?? "").trim();
  const stageId = String(formData.get("stageId") ?? "").trim();
  if (!kind || !isUuid(id)) return { error: NOT_FOUND };
  if (!isUuid(stageId)) return { error: "Choose a stage." };
  try {
    const supabase = await getScopedClient();
    const role = await resolveCurrentRole(supabase);
    if (kind === "matter") {
      if (!MATTER_WRITE_ROLES.includes(role)) return { error: NO_PERMISSION };
      if (!(await recordVisible("matter", id))) return { error: NOT_FOUND };
      await updateMatterStage(id, stageId);
    } else {
      if (!CAN_MOVE_STAGE.includes(role) || !CAN_WRITE_LEAD.includes(role)) return { error: NO_PERMISSION };
      const { data: lead, error: leadErr } = await supabase.from("crm_lead").select("id, current_stage_id").eq("id", id).maybeSingle();
      if (leadErr) throw leadErr;
      if (!lead) return { error: NOT_FOUND };
      const { data: stage, error: stageErr } = await supabase.from("crm_stage").select("id, category").eq("id", stageId).maybeSingle();
      if (stageErr) throw stageErr;
      if (!stage) return { error: "That stage isn't on your pipeline." };
      if (stage.category === "won") return { error: "Open the lead to move it to a won stage." };
      if (lead.current_stage_id === stage.id) return { error: "This lead is already in that stage." };
      await moveLeadStage(id, stage.id);
    }
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't move this record.") };
  }
  refresh();
  return { saved: true };
}

/** Assigned to, from the panel: the matter's owner or the lead's assignee. Empty unassigns. */
export async function assignRecordAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const kind = parseKind(formData.get("kind"));
  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!kind || !isUuid(id)) return { error: NOT_FOUND };
  if (userId && !isUuid(userId)) return { error: "Choose someone from your team." };
  try {
    if (!(await canWrite(kind))) return { error: NO_PERMISSION };
    if (!(await recordVisible(kind, id))) return { error: NOT_FOUND };
    if (userId) {
      const member = await assigneeIsMember(userId);
      if (member === "unknown") return { error: "Couldn't check the team list right now, so nothing was saved. Try again." };
      if (member === "no") return { error: "That person isn't a member of your firm." };
    }
    if (kind === "matter") await assignMatterOwner(id, userId || null);
    else await assignLead(id, userId || null);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't change who this is assigned to.") };
  }
  refresh();
  return { saved: true };
}

/**
 * Source, from the owner's Sheet. The existing write paths only: a lead through `setReferralSource` (the Leads list's
 * source menu, CAN_WRITE_LEAD re-checked inside, logs `lead_updated`), a matter through `updateMatterHeader` (the matter
 * page's "Came from", requireMatterWriteRole inside, logs `matter_updated`). Only one of REFERRAL_SOURCES, or blank to clear.
 */
export async function setSourceAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const kind = parseKind(formData.get("kind"));
  const id = String(formData.get("id") ?? "").trim();
  const raw = String(formData.get("source") ?? "").trim();
  if (!kind || !isUuid(id)) return { error: NOT_FOUND };
  if (raw && !isReferralSource(raw)) return { error: "That isn't one of the sources." };
  try {
    if (!(await canWrite(kind))) return { error: NO_PERMISSION };
    if (!(await recordVisible(kind, id))) return { error: NOT_FOUND };
    if (kind === "matter") await updateMatterHeader(id, { referralSource: raw });
    else await setReferralSource(id, raw && isReferralSource(raw) ? raw : null);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't change the source.") };
  }
  refresh();
  return { saved: true };
}
