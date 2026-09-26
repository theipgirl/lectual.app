"use server";

// Ported from lectual src/app/(firm)/dashboard/pipeline/actions.ts (paths only changed).

import { revalidatePath } from "next/cache";
import { createLead, moveLeadStage } from "@/lib/pipeline";
// Imported from the leaf module rather than the barrel: it is pure and must
// stay usable (and un-mocked) independently of the DB-backed data functions.
import { validateNewLead } from "@/lib/pipeline/lead-input";
import { friendlyLeadWriteError, friendlyMoveStageError, leadFieldErrors } from "./errors";

export type MoveStageResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Board (and lead-detail) "move stage" entry point. Every call re-invokes the
 * role-gated `moveLeadStage` from the data layer — there is no caching of a
 * prior permission check, so a paralegal is refused on every attempt, not
 * just the first. This is the server action's whole job: translate that
 * refusal into a friendly message for the UI instead of an unhandled throw.
 */
export async function moveLeadStageAction(
  leadId: string,
  stageId: string,
): Promise<MoveStageResult> {
  if (!leadId || !stageId) {
    return { ok: false, error: "Missing lead or stage." };
  }

  try {
    await moveLeadStage(leadId, stageId);
  } catch (err) {
    return { ok: false, error: friendlyMoveStageError(err) };
  }

  revalidatePath("/dashboard/leads/");
  revalidatePath(`/dashboard/leads/${leadId}/`);
  return { ok: true };
}

export type CreateLeadState = {
  ok?: boolean;
  /** Set on success so the dialog can navigate to the new lead's detail page. */
  leadId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed back so a rejected submission doesn't wipe what the user typed. */
  values?: Record<string, string>;
};

const LEAD_FORM_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "businessName",
  "website",
] as const;

function readLeadForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of LEAD_FORM_FIELDS) {
    values[field] = String(formData.get(field) ?? "");
  }
  values.currentStageId = String(formData.get("currentStageId") ?? "");
  values.assignedTo = String(formData.get("assignedTo") ?? "");
  return values;
}

/**
 * Creates a lead from the pipeline's "New lead" dialog — the product's only
 * path for a firm to enter its first (or next) client.
 *
 * Validation runs here first so the form can highlight individual fields;
 * `createLead` re-validates and re-checks the caller's role on its own
 * (defense in depth), and RLS is the real boundary underneath both.
 */
export async function createLeadAction(
  _prev: CreateLeadState,
  formData: FormData,
): Promise<CreateLeadState> {
  const values = readLeadForm(formData);

  const validated = validateNewLead(values);
  if (!validated.ok) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: validated.fieldErrors as Record<string, string>,
      values,
    };
  }

  let leadId: string;
  try {
    const lead = await createLead({
      ...values,
      currentStageId: values.currentStageId || null,
      assignedTo: values.assignedTo || null,
      source: "dashboard",
    });
    leadId = lead.id;
  } catch (err) {
    return {
      ok: false,
      error: friendlyLeadWriteError(err, "Couldn't create this lead. Please try again."),
      fieldErrors: leadFieldErrors(err),
      values,
    };
  }

  revalidatePath("/dashboard/leads/");
  revalidatePath("/dashboard/");
  return { ok: true, leadId };
}
