import { getScopedClient } from "@/lib/db/scoped-client";
import { logActivitySafe } from "@/lib/matters";
import { listStages, type Stage } from "@/lib/pipeline/stages";
import { CAN_WRITE_LEAD, resolveCurrentRole, type Lead } from "@/lib/pipeline/leads";
import { LeadWriteError, forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { intakeStageIds } from "./scope";
import type { Temperature } from "./temperature";

/**
 * Server-side reads/writes for the intake dashboard (blueprint §7).
 *
 * Every statement here goes through getScopedClient(), so RLS
 * (crm_lead_select_own / crm_lead_update_staff, 0016) is the tenant boundary —
 * no org_id filter is applied by hand, per AGENTS.md.
 *
 * This module is deliberately NOT re-exported from src/lib/intake/index.ts:
 * that barrel is the pure one the client components import, and routing
 * getScopedClient (and therefore next/headers) through it would drag server
 * code into the browser bundle. Same convention as @/lib/pipeline's "./board".
 */

/**
 * Leads currently in intake: in an intake-category stage (§4.1) AND matching
 * the trademarks-only rule (§4.1 — practice_area null, or containing
 * "trademark" case-insensitively).
 *
 * `stages` is accepted so the page can share the single listStages() read it
 * already makes; omitted, this fetches them itself so the blueprint's bare
 * `listIntakeLeads()` spelling also works.
 *
 * Throws on a query error exactly like listLeads() — the page's three-state
 * handling depends on a failure being a throw and never an empty array
 * (AGENTS.md: an empty result must only ever mean "we looked, and there was
 * nobody").
 */
export async function listIntakeLeads(stages?: Stage[]): Promise<Lead[]> {
  const resolvedStages = stages ?? (await listStages());
  const stageIds = Array.from(intakeStageIds(resolvedStages));

  // A firm with no open/nurture stage before its first won stage has no intake
  // pipeline at all, so there is nothing to ask the database for. Returned
  // early rather than issuing `in.()`, which is a valid-but-odd PostgREST URL
  // for "match nothing". The page reports "no stages configured" separately,
  // so this empty array is never mistaken for a broken read.
  if (stageIds.length === 0) return [];

  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_lead")
    .select("*")
    .in("current_stage_id", stageIds)
    // Null practice_area is INCLUDED on purpose: sheet rows arrive before the
    // importer stamps 'Trademark', and a lead with an unknown practice area
    // silently vanishing from the Monday view is the failure this page exists
    // to avoid.
    .or("practice_area.is.null,practice_area.ilike.%trademark%")
    .order("last_activity_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Sets (or clears, with null) a lead's temperature override — the one human
 * opinion this page writes.
 *
 * Null means "go back to deriving it" (§4.3), so the audit columns are cleared
 * alongside: with no override there is no override to attribute. The clear
 * itself is still recorded on the timeline below, so who reverted it is never
 * lost.
 *
 * Role-gated per call against CAN_WRITE_LEAD — re-resolved via
 * current_org_role() every time, never cached, mirroring the
 * crm_lead_update_staff policy. RLS is the real boundary; this exists so a
 * refusal reads as a sentence instead of a Postgres error.
 */
export async function setTemperature(leadId: string, level: Temperature | null): Promise<Lead> {
  if (!leadId) throw new LeadWriteError("Missing lead.");

  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "set a lead's temperature");
  }

  // The actor comes from the session, never from the caller — same rule the
  // approval queue's `resolved_by` follows.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { data: before, error: beforeError } = await supabase
    .from("crm_lead")
    .select("temperature")
    .eq("id", leadId)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) throw new LeadWriteError("That lead no longer exists.");
  const from = before.temperature ?? null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_lead")
    .update({
      temperature: level,
      temperature_set_at: level === null ? null : now,
      temperature_set_by: level === null ? null : (user?.id ?? null),
      updated_at: now,
    })
    .eq("id", leadId)
    .select("*");
  if (error) throw error;

  // An UPDATE whose USING clause matches nothing — another firm's lead id, or
  // a row deleted between the read above and here — is NOT an error to
  // PostgREST: it succeeds and affects zero rows. Selecting an array rather
  // than .single() is what lets us tell that apart from a real write, so a
  // cross-org id can never come back as a green "saved".
  const updated = (data ?? [])[0];
  if (!updated) {
    throw new LeadWriteError("That lead no longer exists, or isn't visible to your firm.");
  }

  // Audit AFTER the write (see logActivitySafe's contract in
  // src/lib/matters/activity.ts): a failed timeline row must never roll back
  // an edit the user watched succeed.
  await logActivitySafe({
    type: "lead_updated",
    leadId,
    payload: {
      field: "temperature",
      from,
      to: level,
      summary: level ? `Temperature set to ${level}` : "Temperature override cleared",
    },
  });

  return updated;
}
