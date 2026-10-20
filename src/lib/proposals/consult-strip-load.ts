import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadConsultEntries, type ConsultDb } from "@/lib/consult/store";
import { consultStripState, type ConsultStripState } from "./consult-strip";

/** The strip's state for one lead, read through the caller's own scoped client. Never throws. */
export async function loadConsultStrip(leadId: string): Promise<ConsultStripState> {
  try {
    const supabase = await getScopedClient();
    return consultStripState(await loadConsultEntries(supabase as unknown as ConsultDb, leadId));
  } catch {
    return { status: "unavailable", unreadable: false };
  }
}
