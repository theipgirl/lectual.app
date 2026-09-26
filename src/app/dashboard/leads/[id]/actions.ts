"use server";

// Ported from lectual src/app/(firm)/dashboard/leads/[id]/actions.ts: role gate,
// assign, move stage, edit, note, tags, prep-consult and voice notes are
// unchanged. Not ported: the founder link. New: reviewProposalAction.

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { addLeadNote, applyTag, assignLead, removeTag, updateLead } from "@/lib/pipeline";
import { orgHasModule } from "@/lib/org/modules";
import { addVoiceNote, VOICE_NOTE_MAX_BYTES } from "@/lib/voice/notes";
import { queuePrepConsultDrafts } from "@/lib/prep-consult/generate";
import { PrepConsultFlowError } from "@/lib/prep-consult/errors";
import { validateLeadEdit, validateNote } from "@/lib/pipeline/lead-input";
import { LeadWriteError } from "@/lib/pipeline/errors";
import { logActivity } from "@/lib/matters/activity";
import { acceptedUpdate, pendingProposals, REVIEW_SOURCE } from "@/lib/agents/proposals";
import { moveLeadStageAction } from "../actions";
import { friendlyLeadWriteError, leadFieldErrors } from "../errors";

/**
 * Mirrors the crm_lead_update_staff / crm_lead_tag_*_staff RLS policies
 * (supabase/migrations/0016_pipeline.sql): every staff role EXCEPT
 * social_media and viewer may mutate lead data. This is a fast, friendly
 * app-layer check — RLS is the real boundary and must never diverge from
 * this list without updating both (defense-in-depth, never the reverse).
 * (assignLead/applyTag/removeTag in @/lib/pipeline do not self-gate — this
 * app-layer check is the only role gate in front of them today. createLead /
 * updateLead / addLeadNote DO self-gate on the identical CAN_WRITE_LEAD list
 * in @/lib/pipeline, so those run the check twice on purpose.)
 */
const LEAD_WRITE_ROLES: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the caller's role the same way @/lib/pipeline's moveLeadStage
 * does — the `current_org_role()` RPC (JWT-claim-backed, same helper RLS
 * policies use; see supabase/migrations/0002_rls.sql) — then checks it
 * against LEAD_WRITE_ROLES. Re-checked on every call — never cache a prior
 * result across actions.
 */
export async function requireLeadWriteRole(): Promise<Role> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data)) {
    throw new LeadWriteError("You don't have permission to edit leads.", { forbidden: true });
  }
  const role = data;
  if (!LEAD_WRITE_ROLES.includes(role)) {
    throw new LeadWriteError("You don't have permission to edit leads.", { forbidden: true });
  }
  return role;
}

export type ActionState = { error?: string; fieldErrors?: Record<string, string> };

export async function assignLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!leadId || !userId) return { error: "Choose a teammate to assign this lead to." };

  try {
    await requireLeadWriteRole();
    await assignLead(leadId, userId);
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't assign this lead.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}


/**
 * The lead-detail "move stage" control funnels through the same
 * `moveLeadStageAction` the pipeline board uses (single source of truth for
 * the friendly-error translation) rather than re-implementing it.
 */
export async function moveStageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  if (!leadId || !stageId) return { error: "Choose a stage." };

  const result = await moveLeadStageAction(leadId, stageId);
  if (!result.ok) return { error: result.error };
  return {};
}

export type EditLeadState = ActionState & { saved?: boolean };

const EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "businessName",
  "website",
] as const;

/**
 * Corrects a lead's contact details — the only path in the product by which a
 * wrong client email or phone number can be fixed.
 *
 * Every editable field is read from the form (the edit form renders all of
 * them), validated here so individual inputs can be highlighted, and then
 * written by `updateLead`, which re-checks the role and re-validates on its
 * own. `updateLead` also diffs against the stored row, so a submit that
 * changed nothing writes nothing and logs nothing.
 */
export async function editLeadAction(
  _prev: EditLeadState,
  formData: FormData,
): Promise<EditLeadState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { error: "Missing lead." };

  const values: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    values[field] = String(formData.get(field) ?? "");
  }

  const validated = validateLeadEdit(values);
  if (!validated.ok) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: validated.fieldErrors as Record<string, string>,
    };
  }

  try {
    await requireLeadWriteRole();
    await updateLead(leadId, values);
  } catch (err) {
    return {
      error: friendlyLeadWriteError(err, "Couldn't save these changes."),
      fieldErrors: leadFieldErrors(err),
    };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  revalidatePath("/dashboard/leads/");
  return { saved: true };
}

/**
 * Writes a human-authored note / call log / sent-email record onto the lead's
 * timeline. Nothing is sent anywhere by this action — 'call logged' and
 * 'email sent' record something a person already did outside the product; the
 * approval queue remains the only path by which anything reaches a client.
 */
export async function addNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { error: "Missing lead." };

  const input = {
    kind: String(formData.get("kind") ?? "note"),
    body: String(formData.get("body") ?? ""),
    subject: String(formData.get("subject") ?? ""),
  };

  const validated = validateNote(input);
  if (!validated.ok) {
    return {
      error: validated.fieldErrors.body ?? validated.fieldErrors.kind ?? "Check the entry.",
      fieldErrors: validated.fieldErrors as Record<string, string>,
    };
  }

  try {
    await requireLeadWriteRole();
    // NOT best-effort: here the activity row IS the mutation, so a failed
    // insert must surface to the person who typed it rather than being
    // swallowed the way the audit rows on other mutations are.
    await addLeadNote(leadId, input);
  } catch (err) {
    return {
      error: friendlyLeadWriteError(err, "Couldn't save this entry."),
      fieldErrors: leadFieldErrors(err),
    };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}

/**
 * Accept some fields of an email-intel proposal, or dismiss it.
 *
 * Same write gate as editing a lead. The proposal is re-read from the lead's
 * own timeline through RLS, and the values written come from that stored
 * proposal only — the form carries field NAMES, never values. The decision
 * is appended to the timeline (crm_activity is append-only), which is what
 * takes the proposal out of the pending list.
 */
export async function reviewProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const activityId = String(formData.get("activityId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const fields = formData.getAll("field").map(String);
  if (!leadId || !activityId || (decision !== "apply" && decision !== "dismiss")) return { error: "Missing proposal." };

  try {
    await requireLeadWriteRole();
    const supabase = await getScopedClient();
    const { data: rows, error } = await supabase
      .from("crm_activity")
      .select("id, type, created_at, payload")
      .eq("lead_id", leadId)
      .eq("type", "ai_insight");
    if (error) throw error;
    const proposal = pendingProposals(rows ?? []).find((p) => p.activityId === activityId);
    if (!proposal) return { error: "This proposal has already been reviewed." };

    const update = decision === "apply" ? acceptedUpdate(proposal, fields) : {};
    if (decision === "apply") {
      if (Object.keys(update).length === 0) return { error: "Tick at least one change to apply." };
      const { error: upErr } = await supabase.from("crm_lead").update(update).eq("id", leadId);
      if (upErr) throw upErr;
    }
    await logActivity({
      type: "ai_insight",
      leadId,
      actorType: "user",
      payload: { source: REVIEW_SOURCE, message_id: proposal.messageId, decision, applied: Object.keys(update) },
    });
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't save this review.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}

export async function applyTagAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  if (!leadId || !tagId) return { error: "Choose a tag to apply." };

  try {
    await requireLeadWriteRole();
    await applyTag(leadId, tagId, { source: "human" });
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't apply this tag.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}

export async function removeTagAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  if (!leadId || !tagId) return { error: "Missing tag." };

  try {
    await requireLeadWriteRole();
    await removeTag(leadId, tagId);
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't remove this tag.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}

export type PrepConsultActionState = {
  error?: string;
  headsUpQueueItemId?: string;
  clientPrepQueueItemId?: string;
};

/**
 * "Prep this consult" trigger — the `prep-consult` skill's booking-triggered
 * drafts (HEADS-UP + CLIENT-PREP EMAIL), staff-invoked from the lead detail
 * page. See @/lib/prep-consult/generate.ts for the full orchestration and the
 * judgment-boundary discipline (never a Nice class, risk tier, package name,
 * or price). Like every other queue-writing action in this app, nothing here
 * sends anything — both drafts land in the approval queue for review.
 */
export async function prepConsultAction(
  _prev: PrepConsultActionState,
  formData: FormData,
): Promise<PrepConsultActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { error: "Missing lead." };

  // The action is its own entry point — gating the card does not gate this.
  // It drafts client-facing copy in one firm's attorney voice, so a firm
  // without the toolkit must not be able to invoke it by posting directly.
  if (!(await orgHasModule("agent-toolkit"))) {
    return { error: "This isn't available for your firm." };
  }

  try {
    const result = await queuePrepConsultDrafts({
      leadId,
      practiceArea: String(formData.get("practiceArea") ?? ""),
      inquiryDescription: String(formData.get("inquiryDescription") ?? ""),
      sessionWhen: String(formData.get("sessionWhen") ?? ""),
      zoomLink: String(formData.get("zoomLink") ?? ""),
    });
    return {
      headsUpQueueItemId: result.headsUpQueueItemId,
      clientPrepQueueItemId: result.clientPrepQueueItemId,
    };
  } catch (err) {
    return {
      error:
        err instanceof PrepConsultFlowError
          ? err.message
          : "Something went wrong drafting the consult prep emails. Try again, or check that this deployment has an AI provider configured.",
    };
  }
}

/**
 * Saves a recorded voice note onto the lead's timeline. The audio arrives as
 * a File in the form data (recorded in the browser by VoiceNoteRecorder);
 * addVoiceNote uploads it to the org-scoped private bucket, transcribes it
 * best-effort, and appends the 'voice_note' activity row. Like addNoteAction,
 * the activity row IS the mutation — failures surface to the person who
 * recorded it. Nothing is sent to the client.
 */
export async function addVoiceNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { error: "Missing lead." };

  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return { error: "No recording to save — record a voice note first." };
  }
  if (audio.size > VOICE_NOTE_MAX_BYTES) {
    return { error: "That recording is too large — keep voice notes under 10 minutes." };
  }
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);

  try {
    await requireLeadWriteRole();
    await addVoiceNote(
      { leadId },
      {
        bytes: new Uint8Array(await audio.arrayBuffer()),
        // The recorder puts the real MediaRecorder mimeType on the File; strip
        // codec parameters ("audio/webm;codecs=opus" → "audio/webm") so it
        // matches the bucket's allowed_mime_types.
        mime: (audio.type || "").split(";")[0].trim(),
        durationSeconds,
      },
    );
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't save this voice note.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return {};
}
