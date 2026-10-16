import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { stopLeadSequences, stopSequencesForQuote, type StopActor, type StopInput, type StopOutcome, type StoppedEnrollment } from "./stop";
import { rowsOf, str, type StopDb } from "./stop-db";

/**
 * The staff-side entry points to ./stop.ts: they run through the CALLER'S
 * scoped client, so RLS bounds what they can reach, and they read the org off
 * the row (lead or quote) rather than taking it from anyone. Kept apart from
 * ./stop.ts so the public quote page and the mailbox sync, which hold a
 * service-role client, never import the scoped one.
 */

/** The signed-in user's id, or null — never throws (fakes and anonymous paths have no auth). */
export async function sessionUserId(supabase: unknown): Promise<string | null> {
  try {
    const auth = (supabase as { auth?: { getUser: () => Promise<{ data: { user: { id: string } | null } }> } }).auth;
    if (!auth) return null;
    const { data } = await auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * For staff actions: stops sequences for leads the CALLER can see, through the
 * caller's own scoped client. The org is read off the lead rows through RLS,
 * so a lead id from another firm resolves to nothing and stops nothing.
 */
export async function stopLeadSequencesAsStaff(
  input: Omit<StopInput, "orgId" | "actor">,
): Promise<StopOutcome> {
  try {
    const supabase = await getScopedClient();
    const db = supabase as unknown as StopDb;
    const ids = [...new Set(input.leadIds.filter(Boolean))];
    if (ids.length === 0) return { status: "ok", stopped: [] };
    const { data, error } = await db.from("crm_lead").select("id, org_id").in("id", ids);
    if (error) return { status: "failed", error: error.message ?? "lead read failed" };
    const byOrg = new Map<string, string[]>();
    for (const row of rowsOf(data)) {
      const org = str(row.org_id);
      if (org) byOrg.set(org, [...(byOrg.get(org) ?? []), String(row.id)]);
    }
    const actor: StopActor = { type: "user", id: await sessionUserId(supabase) };
    const stopped: StoppedEnrollment[] = [];
    for (const [orgId, leadIds] of byOrg) {
      const outcome = await stopLeadSequences(db, { ...input, orgId, leadIds, actor });
      if (outcome.status !== "ok") return outcome;
      stopped.push(...outcome.stopped);
    }
    return { status: "ok", stopped };
  } catch (err) {
    console.error("[campaigns] staff sequence stop failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Same, keyed by quote — for the staff payment paths. */
export async function stopSequencesForQuoteAsStaff(
  quoteId: string,
  input: Omit<StopInput, "orgId" | "leadIds" | "actor">,
): Promise<StopOutcome> {
  try {
    const supabase = await getScopedClient();
    const db = supabase as unknown as StopDb;
    const { data: quote } = await db.from("crm_quote").select("id, org_id").eq("id", quoteId).maybeSingle();
    const orgId = str((quote as Record<string, unknown> | null)?.org_id);
    if (!orgId) return { status: "ok", stopped: [] };
    return await stopSequencesForQuote(db, { quoteId, orgId }, { ...input, actor: { type: "user", id: await sessionUserId(supabase) } });
  } catch (err) {
    console.error("[campaigns] staff sequence stop for quote failed", err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
