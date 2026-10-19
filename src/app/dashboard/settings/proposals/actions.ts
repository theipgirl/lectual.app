"use server";

import { revalidatePath } from "next/cache";
import { listMemberDirectory } from "@/lib/members/directory";
import { getProposalSettings, saveProposalSettings } from "@/lib/proposals/store";
import { parseSettingsPricing } from "@/lib/proposal-editor/form";
import { proposalActionError, type ActionState } from "../../proposals/errors";
import { gateAdminAction } from "../../proposals/gate";

/**
 * Save the firm's proposal settings: who may approve, the default pay link,
 * where acceptance emails go, and the standard prices + includes a new
 * proposal starts from.
 *
 * Its own POST entry point: the module gate (notFound) and the owner / admin /
 * senior_admin gate run first, and `saveProposalSettings` re-checks the role
 * and validates the input again; 0089's RLS is the boundary underneath.
 *
 * Approvers are picked from the firm's own member directory, and an id that is
 * not on it is refused here: the database holds a bare uuid[] with no
 * foreign key, so nothing else would stop a stray id being named an approver.
 */
export async function saveProposalSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gateAdminAction();
  if (refused) return refused;

  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  try {
    const members = await listMemberDirectory();
    const known = new Set(members.map((m) => m.userId));
    const approvers = formData.getAll("approver").filter((v): v is string => typeof v === "string");
    if (approvers.some((id) => !known.has(id))) return { error: "An approver you picked isn't on your team any more. Refresh the page." };

    const existing = await getProposalSettings();
    const pricing = parseSettingsPricing(formData, existing?.pricing ?? {});
    if (!pricing.ok) return { error: pricing.error };

    await saveProposalSettings({
      approverUserIds: approvers,
      defaultPayUrl: text("defaultPayUrl") || null,
      notifyEmail: text("notifyEmail") || null,
      pricing: pricing.value,
    });
  } catch (err) {
    return proposalActionError(err, "Couldn't save the proposal settings.");
  }
  revalidatePath("/dashboard/settings/proposals/");
  return { saved: true };
}
