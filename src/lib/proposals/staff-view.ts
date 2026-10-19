import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * Is the person opening `/p/<token>` one of the proposal's OWN firm's staff,
 * previewing the page they sent? Their opening must not be logged as the
 * client having viewed it: "viewed" is the firm's signal that the client is
 * reading, and a paralegal checking the link would fake it.
 *
 * ── WHAT IT READS, AND WHAT IT DOES NOT SAY ─────────────────────────────────
 * Reads the visitor's own session cookies through the RLS-scoped client, the
 * same `supabase.auth.getUser()` + `crm_org_member` read the dashboard's
 * `resolveFirmSession` uses. `getUser()` only READS: a visitor with no session
 * gets `null` back without any request to the auth server and nothing is
 * created, so an anonymous client's view costs nothing and is recorded as
 * before. The answer is a boolean used for one decision on the server; neither
 * the user nor the membership reaches the page, the HTML or the view payload,
 * so the client's page cannot reveal that staff look at it.
 *
 * Membership is asked for THIS proposal's org (`org_id` comes off the row the
 * token resolved, never from the request). RLS scopes `crm_org_member` to the
 * visitor's ACTIVE firm, so a person who belongs to two firms and is currently
 * working in the other one is not recognised here, and their view is recorded.
 * That errs toward recording, which is the safe direction.
 *
 * FAILS TOWARD RECORDING: any error, no session, an unreadable membership,
 * all answer `false`.
 */

type MemberRead = PromiseLike<{ data: unknown; error: unknown }>;

/** The slice of the scoped client this needs, so a test can drive it without cookies. */
export interface StaffViewClient {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error?: unknown }> };
  from(table: "crm_org_member"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): MemberRead };
      };
    };
  };
}

export async function isSignedInFirmMember(orgId: string, client?: StaffViewClient): Promise<boolean> {
  try {
    const supabase = client ?? ((await getScopedClient()) as unknown as StaffViewClient);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from("crm_org_member")
      .select("role, org_id")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return false;
    return (data as { org_id?: unknown }).org_id === orgId;
  } catch {
    return false;
  }
}
