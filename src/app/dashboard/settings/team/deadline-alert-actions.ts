"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { revalidatePath } from "next/cache";
import { currentRole } from "@/lib/auth/current-role";
import { listMemberDirectory } from "@/lib/members/directory";
import { ADMIN_TIER_PHRASE, canSeeSetup } from "@/lib/setup/roles";
import { DEADLINE_ALERTS_INELIGIBLE } from "@/lib/ui/words";
import { canReceiveDeadlineAlerts } from "@/lib/today/deadline-alerts";
import { loadRecipientSetting, saveAlertRecipients } from "@/lib/today/deadline-alerts-store";

export type DeadlineAlertState = { error?: string; saved?: boolean };

/**
 * Save who gets the 30- and 7-day deadline alerts. Its own POST entry point: the role is re-read here (admin tier,
 * and RLS on the firm note again), the member list is re-read here, and an id that is not a current member is
 * refused. Nothing else is written. Fixed sentences only.
 */
export const saveDeadlineAlertRecipientsAction = previewSafe(async function saveDeadlineAlertRecipientsAction(_prev: DeadlineAlertState, formData: FormData): Promise<DeadlineAlertState> {
  if (!canSeeSetup(await currentRole())) return { error: `${ADMIN_TIER_PHRASE} can choose who gets deadline alerts.` };
  const picked = formData.getAll("userId");
  if (picked.some((v) => typeof v !== "string")) return { error: "That didn't go through. Refresh the page and try again." };
  let memberIds: Set<string>;
  let eligibleIds: Set<string>;
  try {
    const directory = await listMemberDirectory();
    memberIds = new Set(directory.map((m) => m.userId));
    eligibleIds = new Set(directory.filter((m) => canReceiveDeadlineAlerts(m.role)).map((m) => m.userId));
  } catch {
    return { error: "We couldn't load your team, so nothing was saved. Refresh to try again." };
  }
  const ids = [...new Set(picked as string[])];
  if (ids.some((id) => !memberIds.has(id))) return { error: "Someone you picked isn't on the team any more. Refresh the page and try again." };
  if (ids.some((id) => !eligibleIds.has(id))) return { error: DEADLINE_ALERTS_INELIGIBLE };
  const current = await loadRecipientSetting();
  if (current.status !== "ok") return { error: "We couldn't read the current list, so nothing was saved. Refresh to try again." };
  try {
    await saveAlertRecipients(ids, current.entryId);
  } catch {
    return { error: "Couldn't save the alert recipients. Nothing was changed. Refresh to try again." };
  }
  revalidatePath("/dashboard/settings/team/");
  revalidatePath("/dashboard/");
  return { saved: true };
}, "state");
