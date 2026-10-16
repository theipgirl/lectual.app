"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSequence } from "@/lib/automation/drips";
import { friendlyCampaignError, type ActionState } from "./errors";

/**
 * List-level campaign action. Only sequence CREATION lives here — everything
 * that mutates an existing sequence (steps, pause/start, enrollments) is its
 * own POST entry point in `[id]/actions.ts`, same split as quotes.
 *
 * `createSequence` (src/lib/automation/drips.ts) re-checks the admin gate
 * itself (`requireAutomationAdminRole`, mirroring crm_drip_sequence's
 * `*_insert_admin` RLS policy) — this action does not duplicate that check,
 * it only turns a thrown Error into a readable ActionState.
 */
export async function createSequenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a name for this sequence." };
  const description = String(formData.get("description") ?? "").trim();

  let sequenceId: string;
  try {
    const sequence = await createSequence({ name, description: description || undefined, active: true });
    sequenceId = sequence.id;
  } catch (err) {
    return { error: friendlyCampaignError(err, "Couldn't create this campaign.") };
  }

  revalidatePath("/dashboard/campaigns/");
  redirect(`/dashboard/campaigns/${sequenceId}/`);
}
