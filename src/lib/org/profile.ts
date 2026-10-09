import "server-only";
import { cache } from "react";
import { getScopedClient } from "@/lib/db/scoped-client";
import { currentOrgId, requireSettingsAdminRole } from "@/lib/settings/admin";
import {
  checkLaneLinksInput,
  checkProfileInput,
  DEFAULT_TIME_ZONE,
  resolveTimeZone,
  type LaneLinksInput,
  type OrgProfile,
  type ProfileInput,
} from "./profile-rules";
import { NO_LANE_LINKS, type LaneLinks } from "@/lib/leads/lane";

export type { OrgProfile, ProfileInput } from "./profile-rules";

/**
 * The firm's own presentation settings (lectual 0078, crm_org_profile). No
 * row means defaults. Read by anyone in the firm through RLS; written only by
 * senior_admin and above, and org_id is always the caller's active org.
 */
export async function getOrgProfile(): Promise<OrgProfile | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_org_profile")
    .select("display_name, time_zone, email_signature, updated_at, strategy_session_url, discovery_call_url, nurture_sequence_id")
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

export async function saveOrgProfile(input: ProfileInput & { laneLinks?: LaneLinksInput }): Promise<void> {
  const checked = checkProfileInput(input);
  if (!checked.ok) throw new Error(checked.reason);
  const links = input.laneLinks ? checkLaneLinksInput(input.laneLinks) : null;
  if (links && !links.ok) throw new Error(links.reason);
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const orgId = await currentOrgId(supabase);
  // The nurture campaign must be one of this firm's own (0085's composite FK
  // says so too); read through RLS for a sentence rather than an FK error.
  const nurtureId = links?.ok ? links.value.nurture_sequence_id : null;
  if (nurtureId) {
    const { data: seq, error: seqError } = await supabase.from("crm_drip_sequence").select("id").eq("id", nurtureId).maybeSingle();
    if (seqError) throw seqError;
    if (!seq) throw new Error("That nurture campaign couldn't be found. Refresh and choose it again.");
  }
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("crm_org_profile").upsert(
    {
      org_id: orgId,
      ...checked.value,
      ...(links?.ok ? links.value : {}),
      updated_by: user.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw error;
}

/** The lane next-step settings, for a lead page. A failed read is null links plus `failed`, never "not set". */
export async function getLaneLinks(): Promise<{ links: LaneLinks; failed: boolean }> {
  try {
    const profile = await getOrgProfile();
    return {
      links: {
        strategySessionUrl: profile?.strategy_session_url ?? null,
        discoveryCallUrl: profile?.discovery_call_url ?? null,
        nurtureSequenceId: profile?.nurture_sequence_id ?? null,
      },
      failed: false,
    };
  } catch {
    return { links: NO_LANE_LINKS, failed: true };
  }
}
