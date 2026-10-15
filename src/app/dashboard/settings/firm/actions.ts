"use server";

import { revalidatePath } from "next/cache";
import { saveOrgProfile } from "@/lib/org/profile";
import { friendlySettingsError } from "../team/errors";

export type ProfileState = { error?: string; saved?: boolean };

/** Admin gate and org come from @/lib/settings (and RLS), never the form. */
export async function saveProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  try {
    await saveOrgProfile({
      displayName: String(formData.get("displayName") ?? ""),
      timeZone: String(formData.get("timeZone") ?? ""),
      emailSignature: String(formData.get("emailSignature") ?? ""),
      laneLinks: {
        strategySessionUrl: String(formData.get("strategySessionUrl") ?? ""),
        discoveryCallUrl: String(formData.get("discoveryCallUrl") ?? ""),
        nurtureSequenceId: String(formData.get("nurtureSequenceId") ?? ""),
      },
    });
  } catch (err) {
    return { error: friendlySettingsError(err, "Couldn't save the firm profile.") };
  }
  revalidatePath("/dashboard/settings/firm/");
  return { saved: true };
}
