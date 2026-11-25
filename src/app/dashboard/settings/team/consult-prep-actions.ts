"use server";

import { revalidatePath } from "next/cache";
import { previewSafe } from "@/lib/views/preview-safe";
import { currentRole } from "@/lib/auth/current-role";
import { listMemberDirectory } from "@/lib/members/directory";
import { ADMIN_TIER_PHRASE, canSeeSetup } from "@/lib/setup/roles";
import { canReceiveDeadlineAlerts } from "@/lib/today/deadline-alerts";
import { validateCcForSave, splitTypedAddresses } from "@/lib/consult-prep/recipients";
import { loadConsultPrepSetting, saveConsultPrepSetting } from "@/lib/consult-prep/recipients-store";
import { CONSULT_PREP_TEAM_CC_COUNT, CONSULT_PREP_TEAM_CC_DOMAIN, CONSULT_PREP_TEAM_CC_FORMAT, CONSULT_PREP_TEAM_INELIGIBLE } from "@/lib/ui/words";

export type ConsultPrepEmailsState = { error?: string; saved?: boolean };

/**
 * Save who gets the consult prep emails. Its own POST entry point: the role is re-read here (admin tier, and RLS on the firm note
 * again), the member list is re-read here, an id that is not a current member in a role that can receive it is refused, and every
 * Cc is checked with the SAME guard the send uses (a bare address on a chosen member's domain). Nothing else is written. Fixed
 * sentences only.
 */
export const saveConsultPrepEmailsAction = previewSafe(async function saveConsultPrepEmailsAction(_prev: ConsultPrepEmailsState, formData: FormData): Promise<ConsultPrepEmailsState> {
  if (!canSeeSetup(await currentRole())) return { error: `${ADMIN_TIER_PHRASE} can choose who gets consult prep emails.` };
  const picked = formData.getAll("userId");
  const typed = formData.get("cc");
  if (picked.some((v) => typeof v !== "string") || (typed !== null && typeof typed !== "string")) return { error: "That didn't go through. Refresh the page and try again." };
  let directory: Awaited<ReturnType<typeof listMemberDirectory>>;
  try {
    directory = await listMemberDirectory();
  } catch {
    return { error: "We couldn't load your team, so nothing was saved. Refresh to try again." };
  }
  const ids = [...new Set(picked as string[])];
  const byId = new Map(directory.map((m) => [m.userId, m]));
  if (ids.some((id) => !byId.has(id))) return { error: "Someone you picked isn't on the team any more. Refresh the page and try again." };
  if (ids.some((id) => !canReceiveDeadlineAlerts(byId.get(id)?.role))) return { error: CONSULT_PREP_TEAM_INELIGIBLE };
  const cc = validateCcForSave(splitTypedAddresses(typeof typed === "string" ? typed : ""), ids.map((id) => byId.get(id)?.email));
  if (!cc.ok) return { error: cc.reason === "format" ? CONSULT_PREP_TEAM_CC_FORMAT : cc.reason === "domain" ? CONSULT_PREP_TEAM_CC_DOMAIN : CONSULT_PREP_TEAM_CC_COUNT };
  const current = await loadConsultPrepSetting();
  if (current.status !== "ok") return { error: "We couldn't read the current setting, so nothing was saved. Refresh to try again." };
  try {
    await saveConsultPrepSetting(ids, cc.cc, current.entryId);
  } catch {
    return { error: "Couldn't save the consult prep emails. Nothing was changed. Refresh to try again." };
  }
  revalidatePath("/dashboard/settings/team/");
  return { saved: true };
}, "state")
