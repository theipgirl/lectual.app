import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { leadOptionLabel } from "./lead-label";

/**
 * The leads the proposals page offers in its "Draft from a transcript" picker:
 * the firm's most recent, read through the caller's own scoped client (RLS
 * decides what "the firm's" means). Three-state: a failed read is
 * `unavailable`, never an empty list, so the page can say it could not load
 * them instead of implying the firm has no leads.
 */

export const LEAD_OPTION_LIMIT = 100;

export type LeadOptionRow = { id: string; label: string };
export type LeadOptionsRead = { status: "ok"; leads: LeadOptionRow[] } | { status: "unavailable" };

export { leadOptionLabel };

export async function loadLeadOptions(): Promise<LeadOptionsRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, email")
      .order("created_at", { ascending: false })
      .limit(LEAD_OPTION_LIMIT);
    if (error || !Array.isArray(data)) return { status: "unavailable" };
    return { status: "ok", leads: data.map((l) => ({ id: l.id, label: leadOptionLabel(l) })) };
  } catch {
    return { status: "unavailable" };
  }
}
