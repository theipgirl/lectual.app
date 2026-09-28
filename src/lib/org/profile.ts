import "server-only";
import { cache } from "react";
import { getScopedClient } from "@/lib/db/scoped-client";
import { currentOrgId, requireSettingsAdminRole } from "@/lib/settings/admin";
import { checkProfileInput, DEFAULT_TIME_ZONE, resolveTimeZone, type OrgProfile, type ProfileInput } from "./profile-rules";

export type { OrgProfile, ProfileInput } from "./profile-rules";

/**
 * The firm's own presentation settings (lectual 0073, crm_org_profile). No
 * row means defaults. Read by anyone in the firm through RLS; written only by
 * senior_admin and above, and org_id is always the caller's active org.
 */
export async function getOrgProfile(): Promise<OrgProfile | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_org_profile")
    .select("display_name, time_zone, email_signature, updated_at")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The signed-in firm's time zone (Settings → Firm profile), for date LABELS.
 *
 * Read through the caller's scoped client, so it is the active org's and no
 * other's. No row, an unknown zone, or a failed read all give the default: a
 * label in the default zone is a lesser failure than a page that will not
 * render, and nothing here decides anything (expiry compares instants).
 * Cached per request, since several components on one page ask.
 */
export const getFirmTimeZone = cache(async (): Promise<string> => {
  try {
    const profile = await getOrgProfile();
    return resolveTimeZone(profile?.time_zone);
  } catch {
    return DEFAULT_TIME_ZONE;
  }
});

export async function saveOrgProfile(input: ProfileInput): Promise<void> {
  const checked = checkProfileInput(input);
  if (!checked.ok) throw new Error(checked.reason);
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const orgId = await currentOrgId(supabase);
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("crm_org_profile").upsert(
    { org_id: orgId, ...checked.value, updated_by: user.user?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: "org_id" },
  );
  if (error) throw error;
}
