import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { legacyProposalsFor, type LegacyProposal } from "./legacy";

/** The caller's firm's older proposals. The org comes from the session only; a failed read shows none. */
export async function loadLegacyProposals(): Promise<LegacyProposal[]> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.rpc("current_org_id");
    if (error || typeof data !== "string") return [];
    return legacyProposalsFor(data);
  } catch {
    return [];
  }
}
