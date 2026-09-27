"use server";

import { revalidatePath } from "next/cache";
import { IntakeFormError, saveIntakeForm, type IntakeFormRecord } from "@/lib/intake-forms/store";
import { setIntakeSubmissionStatus } from "@/lib/intake-forms/load-performance";

/**
 * The intake setup page's two POST entry points. Each re-checks the caller's
 * role itself (inside the store functions): a "use server" function is
 * reachable without ever loading the page, so the page's read-only view
 * protects nothing on its own. The org is never taken from the payload —
 * every write goes through the scoped client, and RLS pins it to the active
 * org.
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
export async function saveIntakeFormAction(payload: { config: unknown; allowedDomains: unknown }): Promise<SaveIntakeResult> {
  try {
    const { form, remaining } = await saveIntakeForm({ config: payload?.config, allowedDomains: payload?.allowedDomains });
    revalidatePath("/dashboard/forms/");
    return { ok: true, form, remaining };
  } catch (err) {
    return { ok: false, error: friendly(err, "Couldn't save the intake. Nothing was changed — try again shortly.") };
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
