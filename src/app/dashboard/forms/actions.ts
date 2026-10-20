"use server";

import { revalidatePath } from "next/cache";
import {
  createIntakeForm,
  duplicateIntakeForm,
  IntakeFormError,
  saveIntakeForm,
  setIntakeFormArchived,
  type IntakeFormRecord,
} from "@/lib/intake-forms/store";
import { setIntakeSubmissionStatus } from "@/lib/intake-forms/load-performance";

/**
 * The intake pages' POST entry points. Each re-checks the caller's role
 * itself (inside the store functions): a "use server" function is reachable
 * without ever loading the page, so the page's read-only view protects
 * nothing on its own. The org is never taken from the payload — every write
 * goes through the scoped client, and RLS pins it to the active org. An
 * intake id from the browser only ever selects among the firm's own rows.
 */

export type SaveIntakeResult =
  | { ok: true; form: IntakeFormRecord; remaining: number }
  | { ok: false; error: string };

function friendly(err: unknown, fallback: string): string {
  if (err instanceof IntakeFormError) return err.message;
  console.error("[intake-forms]", err);
  return fallback;
}

/** The editor's Save. Status (draft/live) is decided by the server's checklist, not sent. */
export async function saveIntakeFormAction(payload: {
  id: unknown;
  config: unknown;
  allowedDomains: unknown;
  details: unknown;
}): Promise<SaveIntakeResult> {
  try {
    const { form, remaining } = await saveIntakeForm(String(payload?.id ?? ""), {
      config: payload?.config,
      allowedDomains: payload?.allowedDomains,
      details: payload?.details,
    });
    revalidatePath("/dashboard/forms/");
    return { ok: true, form, remaining };
  } catch (err) {
    return { ok: false, error: friendly(err, "Couldn't save the intake. Nothing was changed — try again shortly.") };
  }
}

export type IntakeListResult = { ok: true; id: string } | { ok: false; error: string };

/** "New intake": a draft from the defaults, chat/form or assessment. */
export async function createIntakeFormAction(name: unknown, kind: unknown = "intake"): Promise<IntakeListResult> {
  try {
    const form = await createIntakeForm(name, kind);
    revalidatePath("/dashboard/forms/");
    return { ok: true, id: form.id };
  } catch (err) {
    return { ok: false, error: friendly(err, "Couldn't create the intake. Try again shortly.") };
  }
}

/** "Duplicate": the same setup under a new link, as a draft. */
export async function duplicateIntakeFormAction(id: unknown): Promise<IntakeListResult> {
  try {
    const form = await duplicateIntakeForm(String(id ?? ""));
    revalidatePath("/dashboard/forms/");
    return { ok: true, id: form.id };
  } catch (err) {
    return { ok: false, error: friendly(err, "Couldn't duplicate the intake. Nothing was copied; try again shortly.") };
  }
}

/** "Archive" / "Restore". */
export async function setIntakeArchivedAction(id: unknown, archived: unknown): Promise<IntakeListResult> {
  try {
    const form = await setIntakeFormArchived(String(id ?? ""), archived === true);
    revalidatePath("/dashboard/forms/");
    return { ok: true, id: form.id };
  } catch (err) {
    return { ok: false, error: friendly(err, "Couldn't change the intake. Try again shortly.") };
  }
}

export type StatusState = { error?: string; saved?: boolean };

/** The drawer's status control. */
export async function setIntakeStatusAction(_prev: StatusState, formData: FormData): Promise<StatusState> {
  try {
    await setIntakeSubmissionStatus(String(formData.get("id") ?? ""), String(formData.get("status") ?? ""));
  } catch (err) {
    return { error: friendly(err, "Couldn't change the status. Try again shortly.") };
  }
  revalidatePath("/dashboard/forms/");
  return { saved: true };
}
