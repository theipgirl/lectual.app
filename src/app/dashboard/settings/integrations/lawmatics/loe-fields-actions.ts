"use server";

import { revalidatePath } from "next/cache";
import { gateAdminAction } from "@/app/dashboard/proposals/gate";
import { proposalActionError, type ActionState } from "@/app/dashboard/proposals/errors";
import { parseLoeFieldsForm, readLoeFieldsConfig, withLoeFields } from "@/lib/proposals/loe-fields";
import { getProposalSettings, saveProposalSettings } from "@/lib/proposals/store";

/**
 * Saves the "LOE fields" setting (Settings -> Integrations -> Lawmatics). OFF by default.
 *
 * It rides in `client_proposal_setting.pricing` under `lawmatics_loe_fields` (no migration),
 * so it has the same gates as the rest of that row: the proposals module (notFound when off),
 * then owner / admin / senior_admin, re-checked by `saveProposalSettings`. Everything else on
 * the row (approvers, pay link, notify address, prices) is read back and saved as it was.
 *
 * When the Lawmatics field list couldn't be loaded the form posts `mapping=keep` and no
 * choices: the saved matches are kept and only the on/off switch changes.
 */
export async function saveLoeFieldsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateAdminAction();
  if (refused) return refused;

  const parsed = parseLoeFieldsForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const existing = await getProposalSettings();
    const pricing = existing?.pricing ?? {};
    const config = formData.get("mapping") === "keep" ? { enabled: parsed.value.enabled, map: readLoeFieldsConfig(pricing).map } : parsed.value;
    await saveProposalSettings({
      approverUserIds: existing?.approver_user_ids ?? [],
      defaultPayUrl: existing?.default_pay_url ?? null,
      notifyEmail: existing?.notify_email ?? null,
      pricing: withLoeFields(pricing, config),
    });
  } catch (err) {
    return proposalActionError(err, "Couldn't save the LOE fields.");
  }
  revalidatePath("/dashboard/settings/integrations/lawmatics/");
  return { saved: true, notice: "Saved." };
}
