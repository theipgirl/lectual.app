import type { getScopedClient } from "@/lib/db/scoped-client";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Stamps a lead's last touch: sets `crm_lead.last_activity_at` to now, so the
 * Intake list's default sort (last thing that happened, newest first) moves a
 * lead to the top the moment someone writes a note, a voice note or links a
 * meeting to it.
 *
 * BEST-EFFORT, and that is the contract. The note or the link the person just
 * saved is the real write; this only keeps the list's ordering honest. A
 * returned error and a thrown one are both swallowed (and logged with the
 * greppable `[touch]` prefix), so a bump that can't land never fails, undoes or
 * changes the result of the write it follows.
 *
 * Runs through the caller's scoped client, so RLS is the tenant boundary; the
 * org filter is added when the caller already knows the row's org_id.
 */
export async function bumpLeadLastTouch(
  supabase: ScopedClient,
  leadId: string,
  orgId?: string | null,
  at: Date = new Date(),
): Promise<void> {
  try {
    const update = supabase.from("crm_lead").update({ last_activity_at: at.toISOString() }).eq("id", leadId);
    const { error } = await (orgId ? update.eq("org_id", orgId) : update);
    if (error) console.error(`[touch] failed to bump last touch for lead=${leadId}`, error);
  } catch (err) {
    console.error(`[touch] failed to bump last touch for lead=${leadId}`, err);
  }
}
