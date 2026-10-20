"use server";

import { revalidatePath } from "next/cache";
import { logConsultOutcome } from "@/lib/pipeline/consult-outcome";
import { friendlyLeadWriteError } from "../errors";

export type ConsultOutcomeState = { error?: string; saved?: boolean };

/**
 * The lead page's "Log a consult outcome" form. The data layer re-checks the
 * role (CAN_WRITE_LEAD) and reads the lead through RLS on every call; this wrapper
 * only turns a failure into a sentence that is safe to show. Nothing is sent.
 */
export async function logConsultOutcomeAction(
  _prev: ConsultOutcomeState,
  formData: FormData,
): Promise<ConsultOutcomeState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { error: "Missing lead." };

  try {
    await logConsultOutcome(leadId, {
      outcome: String(formData.get("outcome") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
  } catch (err) {
    return { error: friendlyLeadWriteError(err, "Couldn't save this outcome.") };
  }

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return { saved: true };
}
