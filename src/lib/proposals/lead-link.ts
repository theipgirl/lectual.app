import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { leadOptionLabel } from "./lead-label";

/**
 * Whose proposal this is, for the editor's header (Sprint 28 E). Read through the caller's own
 * scoped client, so another firm's lead id reads the same as a deleted one. Three states: a read
 * that failed is "couldn't be loaded", never "not linked".
 */
export type LeadLinkState =
  | { state: "linked"; id: string; name: string }
  | { state: "unreadable"; id: string }
  | { state: "none" };

export async function loadLeadLink(leadId: string | null): Promise<LeadLinkState> {
  if (!leadId) return { state: "none" };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, email")
      .eq("id", leadId)
      .maybeSingle();
    if (error || !data) return { state: "unreadable", id: leadId };
    return { state: "linked", id: data.id, name: leadOptionLabel(data) };
  } catch {
    return { state: "unreadable", id: leadId };
  }
}
