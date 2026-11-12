import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { firmDisplayName } from "@/lib/proposals/commitment";
import { getOrgProfile } from "@/lib/org/profile";
import { resolveTimeZone } from "@/lib/org/profile-rules";

/**
 * What the signed letter's PDF needs from the firm, for a SIGNED-IN person: the letterhead name and the time zone, read through
 * the caller's scoped client (the active org only). Three-state: a failed read is `unavailable`, never a letter with no firm name.
 */
export type StaffFirmFacts = { status: "ok"; displayName: string; timeZone: string } | { status: "unavailable" };

export async function loadStaffFirmFacts(): Promise<StaffFirmFacts> {
  try {
    const db = await getScopedClient();
    const [org, profile] = await Promise.all([db.from("crm_org").select("name").maybeSingle(), getOrgProfile()]);
    const name = !org.error && org.data && typeof org.data.name === "string" ? org.data.name : "";
    if (!name) return { status: "unavailable" };
    return { status: "ok", displayName: firmDisplayName(profile?.display_name ?? null, name), timeZone: resolveTimeZone(profile?.time_zone) };
  } catch {
    return { status: "unavailable" };
  }
}
