"use server";

// Ported from lectual src/app/(firm)/dashboard/matters/[id]/actions.ts. The
// validation, role gate and data calls are unchanged. Two differences:
//   - errors go through friendlyMatterError, so no raw database message
//     reaches the screen (lectual returned err.message as-is);
//   - assignMatterOwnerAction comes from lectual's team-status/actions.ts.
// Litigation facts, voice notes, the welcome email and the filing follow-up
// are module-gated in the action itself (a POST never renders the page).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { orgHasModule } from "@/lib/org/modules";
import {
  assignMatterOwner,
  closeDeadline,
  completeTask,
  confirmDeadline,
  createDeadline,
  createMatter,
  createTask,
  extendDeadline,
  updateMatterIpFields,
  updateMatterNotes,
  updateMatterStatus,
  type MatterIpFields,
  type MatterRow,
} from "@/lib/matters";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { isMatterStatus } from "@/lib/matters/status";
import { MATTER_TYPE_MODULE, isMatterType, requiresExplicitMatterNumber } from "@/lib/matters/matter-types";
import { updateMatterStage } from "@/lib/matters/stages";
import { blankToNull, isFilingBasis, parseCivilDate, parseInternationalClasses } from "@/lib/matters/ip-fields";
import { isDeadlineKind, isDeadlineSource, isDeadlineStatus } from "@/lib/matters/deadline-rules";
import { upsertLitigationDetail, type LitigationDetailInput } from "@/lib/matters/litigation";
import { courtWallClockToUtcIso } from "@/lib/matters/court-time";
import { addVoiceNote, VOICE_NOTE_MAX_BYTES } from "@/lib/voice/notes";
import { generateWelcomeEmail } from "@/lib/welcome/generate";
import { queueMonthlyStatusUpdate } from "@/lib/matters/filing-followup-action";
import { DocumentFlowError } from "@/lib/documents/errors";
import { friendlyMatterError } from "../errors";

export type FollowUpActionState = { error?: string; queueItemId?: string };

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The caller's role from `current_org_role()` (the same JWT-claim helper RLS
 * uses), checked against MATTER_WRITE_ROLES. Re-checked on every call.
 */
export async function requireMatterWriteRole(): Promise<Role> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !MATTER_WRITE_ROLES.includes(data)) {
    throw new Error("You don't have permission to edit matters.");
  }
  return data;
}

export type ActionState = { error?: string; saved?: boolean };

function revalidateMatter(matterId?: string) {
  if (matterId) revalidatePath(`/dashboard/matters/${matterId}/`);
  revalidatePath("/dashboard/matters/");
  revalidatePath("/dashboard/");
}

/** Only fields the form posted come back, so one group can't blank another. */
function readIpFields(formData: FormData): MatterIpFields {
  const fields: MatterIpFields = {};
  const has = (name: string) => formData.has(name);

  if (has("markText")) fields.markText = blankToNull(formData.get("markText"));
  if (has("serialNumber")) fields.serialNumber = blankToNull(formData.get("serialNumber"));
  if (has("registrationNumber")) fields.registrationNumber = blankToNull(formData.get("registrationNumber"));
  if (has("filingBasis")) {
    const raw = blankToNull(formData.get("filingBasis"));
    if (raw !== null && !isFilingBasis(raw)) throw new Error("Choose a valid filing basis.");
    fields.filingBasis = raw;
  }
  if (has("filingDate")) fields.filingDate = parseCivilDate(formData.get("filingDate"));
  if (has("registrationDate")) fields.registrationDate = parseCivilDate(formData.get("registrationDate"));
  if (has("internationalClasses")) {
    fields.internationalClasses = parseInternationalClasses(blankToNull(formData.get("internationalClasses")));
  }
  if (has("goodsServices")) fields.goodsServices = blankToNull(formData.get("goodsServices"));
  if (has("examiningAttorney")) fields.examiningAttorney = blankToNull(formData.get("examiningAttorney"));

  // uspto_status and its as-of date travel together (0035's
  // crm_matter_uspto_status_dated CHECK), so a status can't go stale unseen.
  if (has("usptoStatus") || has("usptoStatusAsOf")) {
    const status = blankToNull(formData.get("usptoStatus"));
    const asOf = parseCivilDate(formData.get("usptoStatusAsOf"));
    if (status !== null && asOf === null) {
      throw new Error("Add the date the USPTO status was read, so it can't go stale unnoticed.");
    }
    fields.usptoStatus = status;
    fields.usptoStatusAsOf = status === null ? null : asOf;
  }
  return fields;
}

/** Opens a matter and goes to it. redirect() stays outside the try: it throws on purpose. */
export async function createMatterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const typeRaw = String(formData.get("type") ?? "");
  if (!isMatterType(typeRaw)) return { error: "Choose a matter type." };

  // A "use server" function is its own POST entry point, so hiding LIT in the
  // form gates nothing. Fails closed.
  const requiredModule = MATTER_TYPE_MODULE[typeRaw];
  if (requiredModule && !(await orgHasModule(requiredModule))) {
    return { error: "This isn't available for your firm." };
  }

  const leadId = String(formData.get("leadId") ?? "").trim() || undefined;
  const title = String(formData.get("title") ?? "").trim() || undefined;
  const packageName = String(formData.get("packageName") ?? "").trim() || undefined;
  const matterNumber = String(formData.get("matterNumber") ?? "").trim() || undefined;
  if (!matterNumber && requiresExplicitMatterNumber(typeRaw)) {
    return { error: "Enter the court case number as the matter number (e.g. 26-CC-011354)." };
  }

  let matter: MatterRow;
  try {
    await requireMatterWriteRole();
    matter = await createMatter({ type: typeRaw, leadId, title, packageName, matterNumber, ...readIpFields(formData) });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't open this matter.") };
  }

  revalidateMatter();
  redirect(`/dashboard/matters/${matter.id}/`);
}

export async function updateMatterStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  const status = String(formData.get("status") ?? "").trim();
  if (!matterId || !status) return { error: "Choose a status." };
  if (!isMatterStatus(status)) return { error: "Choose a valid status." };

  try {
    await requireMatterWriteRole();
    await updateMatterStatus(matterId, status);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't update this matter's status.") };
  }
  revalidateMatter(matterId);
  return {};
}

/** Where the matter sits in the firm's own process. Not the same thing as status. */
export async function updateMatterStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  const stageId = String(formData.get("stageId") ?? "").trim();
  if (!matterId || !stageId) return { error: "Choose a stage." };

  try {
    await requireMatterWriteRole();
    await updateMatterStage(matterId, stageId);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't move this matter.") };
  }
  revalidateMatter(matterId);
  return {};
}

/** From lectual's Team Status page. An empty choice unassigns. */
export async function assignMatterOwnerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  const userId = String(formData.get("userId") ?? "").trim();
  if (!matterId) return { error: "Missing matter." };

  try {
    await requireMatterWriteRole();
    await assignMatterOwner(matterId, userId || null);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't change the owner.") };
  }
  revalidateMatter(matterId);
  return {};
}

export async function updateMatterIpFieldsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  try {
    await requireMatterWriteRole();
    await updateMatterIpFields(matterId, readIpFields(formData));
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save these filing details.") };
  }
  revalidateMatter(matterId);
  return { saved: true };
}

export async function updateMatterNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  try {
    await requireMatterWriteRole();
    await updateMatterNotes(matterId, blankToNull(formData.get("notes")));
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save these notes.") };
  }
  revalidatePath(`/dashboard/matters/${matterId}/`);
  return { saved: true };
}

/**
 * Dockets a deadline. The submitted date wins over any suggestion, and the
 * row is always stored unconfirmed.
 */
export async function createDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!matterId) return { error: "Missing matter." };
  if (!isDeadlineKind(kind)) return { error: "Choose what's due." };

  const sourceRaw = String(formData.get("source") ?? "calculated");
  const source = isDeadlineSource(sourceRaw) ? sourceRaw : "calculated";

  try {
    await requireMatterWriteRole();
    const dueDate = parseCivilDate(formData.get("dueDate"));
    if (!dueDate) return { error: "Enter the due date." };
    await createDeadline({
      matterId,
      kind,
      dueDate,
      anchorEvent: blankToNull(formData.get("anchorEvent")),
      anchorDate: parseCivilDate(formData.get("anchorDate")),
      source,
      calculationBasis: source === "calculated" ? blankToNull(formData.get("calculationBasis")) : null,
      notes: blankToNull(formData.get("notes")),
    });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't docket this deadline.") };
  }
  revalidateMatter(matterId);
  return {};
}

/**
 * An attorney's confirmation of a docket date. Attorney/owner only, in
 * confirmDeadline AND in the crm_matter_deadline_confirmation_guard trigger,
 * which stamps the confirmer from the session, never the form.
 */
export async function confirmDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const deadlineId = String(formData.get("deadlineId") ?? "");
  const matterId = String(formData.get("matterId") ?? "");
  if (!deadlineId) return { error: "Missing deadline." };

  try {
    await confirmDeadline(deadlineId);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't confirm this date.") };
  }
  revalidateMatter(matterId);
  return {};
}

/** Closes a docket entry out (satisfied / waived / superseded). Never deletes. */
export async function closeDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const deadlineId = String(formData.get("deadlineId") ?? "");
  const matterId = String(formData.get("matterId") ?? "");
  const status = String(formData.get("status") ?? "satisfied");
  if (!deadlineId) return { error: "Missing deadline." };
  if (!isDeadlineStatus(status) || status === "open") return { error: "Choose how this deadline was closed out." };

  try {
    await requireMatterWriteRole();
    await closeDeadline(deadlineId, status, blankToNull(formData.get("note")));
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't close this deadline out.") };
  }
  revalidateMatter(matterId);
  return {};
}

export async function extendDeadlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const deadlineId = String(formData.get("deadlineId") ?? "");
  const matterId = String(formData.get("matterId") ?? "");
  if (!deadlineId) return { error: "Missing deadline." };

  try {
    await requireMatterWriteRole();
    const newDueDate = parseCivilDate(formData.get("dueDate"));
    if (!newDueDate) return { error: "Enter the new due date." };
    await extendDeadline(deadlineId, newDueDate);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't extend this deadline.") };
  }
  revalidateMatter(matterId);
  return {};
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!matterId || !title) return { error: "Enter a task title." };
  const dueAtRaw = String(formData.get("dueAt") ?? "").trim();

  try {
    await requireMatterWriteRole();
    await createTask({ matterId, title, dueAt: dueAtRaw || undefined });
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't create this task.") };
  }
  revalidatePath(`/dashboard/matters/${matterId}/`);
  return {};
}

export async function completeTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const matterId = String(formData.get("matterId") ?? "");
  if (!taskId) return { error: "Missing task." };

  try {
    await requireMatterWriteRole();
    await completeTask(taskId);
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't complete this task.") };
  }
  if (matterId) revalidatePath(`/dashboard/matters/${matterId}/`);
  return {};
}

/**
 * Reads the litigation facts out of a submitted form (0040's
 * crm_litigation_detail). Same contract as readIpFields: only fields the form
 * actually posted are returned, and every blank saves as NULL so clearing a
 * box genuinely clears the record.
 */
function readLitigationFields(formData: FormData): LitigationDetailInput {
  const fields: LitigationDetailInput = {};
  const text: Array<[keyof LitigationDetailInput, string]> = [
    ["county", "county"],
    ["caseNumber", "caseNumber"],
    ["caseStyle", "caseStyle"],
    ["courtDivision", "courtDivision"],
    ["judge", "judge"],
    ["role", "role"],
    ["caseStatus", "caseStatus"],
    ["noticeOfAppearance", "noticeOfAppearance"],
    ["motionToDismiss", "motionToDismiss"],
    ["missedHearing", "missedHearing"],
    ["defaultStatus", "defaultStatus"],
    ["nextHearingPurpose", "nextHearingPurpose"],
    ["notes", "notes"],
  ];
  for (const [key, field] of text) {
    if (formData.has(field)) fields[key] = blankToNull(formData.get(field));
  }
  if (formData.has("filedOn")) fields.filedOn = parseCivilDate(formData.get("filedOn"));
  if (formData.has("nextHearingAt")) {
    fields.nextHearingAt = parseHearingInstant(formData.get("nextHearingAt"));
  }
  return fields;
}

/**
 * Parses a `<input type="datetime-local">` value for next_hearing_at.
 *
 * The reading is a COURT wall clock ("Aug 25, 10:00am"), so it is converted
 * from court time, not from UTC and not from whatever zone the server happens
 * to run in — see src/lib/matters/court-time.ts for why that distinction is
 * worth four hours on a hearing date.
 */
function parseHearingInstant(value: FormDataEntryValue | null | undefined): string | null {
  const raw = blankToNull(value);
  if (raw === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) {
    throw new Error(`"${raw}" is not a valid date and time.`);
  }
  // Validates the calendar date itself (Feb 30 would otherwise roll silently).
  parseCivilDate(match[1]);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`"${raw}" is not a valid time of day.`);
  }
  const [y, mo, d] = match[1].split("-").map(Number);
  return courtWallClockToUtcIso(y, mo, d, hours, minutes);
}

/**
 * Saves the litigation facts on a LIT matter — the write path
 * crm_litigation_detail never had, which is why Cabanis Law's imported cases
 * were frozen at whatever the import wrote.
 *
 * Module-gated HERE as well as in upsertLitigationDetail, for the reason
 * sendWelcomeEmailAction spells out: this function is its own POST entry
 * point, so gating the card gates nothing. Role gating, the org_id
 * provenance (read off the parent matter) and the LIT-type check all live in
 * upsertLitigationDetail; this wrapper reads the form and revalidates.
 */
export async function updateLitigationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  if (!(await orgHasModule("litigation"))) {
    return { error: "This isn't available for your firm." };
  }

  try {
    await requireMatterWriteRole();
    await upsertLitigationDetail(matterId, readLitigationFields(formData));
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save these litigation details.") };
  }

  revalidatePath(`/dashboard/matters/${matterId}/`);
  revalidatePath("/dashboard/matters/");
  return {};
}

/**
 * Saves a recorded voice note onto the matter's timeline. The audio arrives as
 * a File in the form data (recorded in the browser by the shared
 * VoiceNoteRecorder); addVoiceNote uploads it to the org-scoped private bucket
 * at `{org_id}/{matter_id}/{note_id}.{ext}`, transcribes it best-effort, and
 * appends the 'voice_note' activity row.
 *
 * Here the activity row IS the mutation, so failures surface to the person who
 * recorded it rather than being swallowed the way this file's audit rows are.
 * Nothing is sent to the client — a voice note is an internal team memo.
 */
export async function addVoiceNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return { error: "No recording to save — record a voice note first." };
  }
  if (audio.size > VOICE_NOTE_MAX_BYTES) {
    return { error: "That recording is too large — keep voice notes under 10 minutes." };
  }
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);

  try {
    await requireMatterWriteRole();
    await addVoiceNote(
      { matterId },
      {
        bytes: new Uint8Array(await audio.arrayBuffer()),
        // Strip codec parameters ("audio/webm;codecs=opus" → "audio/webm") so
        // the type matches the bucket's allowed_mime_types.
        mime: (audio.type || "").split(";")[0].trim(),
        durationSeconds,
      },
    );
  } catch (err) {
    return { error: friendlyMatterError(err, "Couldn't save this voice note.") };
  }

  revalidatePath(`/dashboard/matters/${matterId}/`);
  return {};
}

export type WelcomeEmailState = { error?: string; queueItemId?: string };

/**
 * The `welcome-client` skill trigger for the matter detail page — see
 * src/lib/welcome/generate.ts. Role-gating, the trademark-only scope, and the
 * one-per-matter idempotency check all live in generateWelcomeEmail itself
 * (same split as generateTrademarkLoe/generateOpinionLetter), so this action
 * only reads the form and turns a thrown WelcomeFlowError into form state.
 *
 * Stays on the matter page (revalidate, not redirect) so staff can keep
 * working the matter; the returned queueItemId lets the button's success
 * state link straight to the queued draft for review.
 */
export async function sendWelcomeEmailAction(
  _prev: WelcomeEmailState,
  formData: FormData,
): Promise<WelcomeEmailState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  // The action is its own entry point — gating the card does not gate this.
  // It drafts client-facing copy in one firm's attorney voice, so a firm
  // without the toolkit must not be able to invoke it by posting directly.
  if (!(await orgHasModule("agent-toolkit"))) {
    return { error: "This isn't available for your firm." };
  }

  let queueItemId: string;
  try {
    const result = await generateWelcomeEmail({ matterId });
    queueItemId = result.queueItemId;
  } catch (err) {
    return {
      error: friendlyMatterError(err, "Couldn't draft the welcome email."),
    };
  }

  revalidatePath(`/dashboard/matters/${matterId}/`);
  return { queueItemId };
}

/**
 * Drafts and queues the next monthly status-update email for a matter in the
 * Awaiting Trademark Registration stage (src/lib/matters/filing-followup-
 * action.ts). Role-gated and due-ness-checked inside that module — this
 * wrapper only shapes the result for the card's useActionState and
 * revalidates the surfaces that show a follow-up state (the matter page
 * itself and Team Status's "Filing follow-ups due" section).
 */
export async function queueMonthlyStatusUpdateAction(
  _prev: FollowUpActionState,
  formData: FormData,
): Promise<FollowUpActionState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  // Same reasoning as sendWelcomeEmailAction above: the action is its own
  // entry point, so gating the card does not gate this. The draft it queues
  // is a client email signed in one firm's operations voice.
  if (!(await orgHasModule("agent-toolkit"))) {
    return { error: "This isn't available for your firm." };
  }

  let queueItemId: string;
  try {
    ({ queueItemId } = await queueMonthlyStatusUpdate(matterId));
  } catch (err) {
    return {
      error: err instanceof DocumentFlowError ? err.message : friendlyMatterError(err, "Couldn't draft this status update."),
    };
  }

  revalidatePath(`/dashboard/matters/${matterId}/`);
  revalidatePath("/dashboard/team-status");
  return { queueItemId };
}
