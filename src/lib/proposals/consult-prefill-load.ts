import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadReviewedConsult, type ConsultDb, type ReviewedConsultRead } from "@/lib/consult/store";

/**
 * A lead's reviewed consult details for New proposal, through the caller's own
 * scoped client (RLS decides whose notes these are; no org id is taken from the
 * URL or the form). The one place this feature reads consult details: the page
 * (to show what will be filled) and the create action (to build it again from
 * what is stored now, never from what the browser says) both call it. Never
 * throws: a failed read is `unavailable`, which is not "no consult".
 */
export async function loadConsultForPrefill(leadId: string): Promise<ReviewedConsultRead> {
  try {
    const supabase = await getScopedClient();
    return await loadReviewedConsult(supabase as unknown as ConsultDb, leadId);
  } catch {
    return { status: "unavailable" };
  }
}
