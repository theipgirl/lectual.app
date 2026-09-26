"use server";

// Ported from lectual src/app/(firm)/dashboard/matters/[id]/actions.ts. The
// validation, role gate and data calls are unchanged. Two differences:
//   - errors go through friendlyMatterError, so no raw database message
//     reaches the screen (lectual returned err.message as-is);
//   - assignMatterOwnerAction comes from lectual's team-status/actions.ts.
// Not ported yet: litigation facts, voice notes, the welcome email and the
// filing follow-up (the last two are agent-toolkit cards).

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
import { friendlyMatterError } from "../errors";

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
