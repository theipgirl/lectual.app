import { getScopedClient } from "@/lib/db/scoped-client";
import { logActivitySafe } from "@/lib/matters";
import { listStages, type Stage } from "@/lib/pipeline/stages";
import { CAN_WRITE_LEAD, resolveCurrentRole, type Lead } from "@/lib/pipeline/leads";
import { LeadWriteError, forbiddenLeadWrite } from "@/lib/pipeline/errors";
import { intakeStageIds } from "./scope";
import { INTAKE_PRACTICE_AREA_FILTER } from "./counts";
import { suggestedLane, type Lane } from "@/lib/leads/lane";
import { isReferralSource, type ReferralSource } from "./referral-source";

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
  // so this empty array is never mistaken for a failed read.
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
    .or(INTAKE_PRACTICE_AREA_FILTER)
    .order("last_activity_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Sets (or clears, with null) the lead's routing LANE — the person's call
 * that overrides the triage agent's suggestion (intake SOP Stage 2: "Taylor
 * can override"). This is the one write behind the Temperature column: the
 * person's lane, shown as the lead's temperature, and it decides the next step.
 *
 * Who and when are stamped by the database from the session (lectual 0085's
 * crm_lead_lane_guard), and the trigger refuses a write without a session,
 * which is what keeps the triage agent from ever setting it. The timeline row
 * records who, from → to, and what triage had suggested, so an override reads
 * as an override.
 */
export async function setLane(leadId: string, lane: Lane | null): Promise<Lead> {
  if (!leadId) throw new LeadWriteError("Missing lead.");

  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "set a lead's lane");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { data: before, error: beforeError } = await supabase
    .from("crm_lead")
    .select("lane, ai_summary")
    .eq("id", leadId)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) throw new LeadWriteError("That lead no longer exists.");
  const from = before.lane ?? null;
  if (from === lane) {
    const { data: unchanged, error } = await supabase.from("crm_lead").select("*").eq("id", leadId).single();
    if (error) throw error;
    return unchanged;
  }

  const { data, error } = await supabase
    .from("crm_lead")
    .update({ lane, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .select("*");
  if (error) throw error;
  const updated = (data ?? [])[0];
  if (!updated) {
    throw new LeadWriteError("That lead no longer exists, or isn't visible to your firm.");
  }

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const by =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    user?.email ||
    null;
  await logActivitySafe({
    type: "lead_updated",
    leadId,
    payload: {
      field: "lane",
      from,
      to: lane,
      suggested: suggestedLane(before.ai_summary),
      by,
      summary: lane ? `Temperature set to ${lane}` : "Temperature cleared",
    },
  });

  return updated;
}

/**
 * Sets (or clears, with null) a lead's referral source — the staff correction
 * for a source the importer bucketed wrong or couldn't know (Rebecca: sources
 * are often missing from the sheet).
 *
 * The value must be one of REFERRAL_SOURCES; anything else is refused here as
 * well as in the action, so no caller can write a free-text bucket that the
 * Source filter would never match. `referral_detail` (the verbatim import text)
 * is deliberately left alone: it is the record of what the sheet said, and the
 * timeline row below records what a person changed the bucket from and to.
 *
 * Same gate as the other lead edits: CAN_WRITE_LEAD, re-resolved per call,
 * mirroring crm_lead_update_staff. A change to the value it already holds is a
 * no-op with no timeline row.
 */
export async function setReferralSource(
  leadId: string,
  source: ReferralSource | null,
): Promise<Lead> {
  if (!leadId) throw new LeadWriteError("Missing lead.");
  if (source !== null && !isReferralSource(source)) {
    throw new LeadWriteError("That isn't one of the sources.");
  }

  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "set a lead's source");
  }

  const { data: before, error: beforeError } = await supabase
    .from("crm_lead")
    .select("referral_source")
    .eq("id", leadId)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) throw new LeadWriteError("That lead no longer exists.");
  const from = before.referral_source ?? null;
  if (from === source) {
    const { data: unchanged, error } = await supabase.from("crm_lead").select("*").eq("id", leadId).single();
    if (error) throw error;
    return unchanged;
  }

  const { data, error } = await supabase
    .from("crm_lead")
    .update({ referral_source: source, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .select("*");
  if (error) throw error;
  // An UPDATE whose USING clause matches nothing (another firm's lead id, or a row
  // deleted in between) is not an error to PostgREST: it affects zero rows. Selecting
  // an array rather than .single() tells that apart from a real write.
  const updated = (data ?? [])[0];
  if (!updated) {
    throw new LeadWriteError("That lead no longer exists, or isn't visible to your firm.");
  }

  await logActivitySafe({
    type: "lead_updated",
    leadId,
    payload: {
      field: "referral_source",
      from,
      to: source,
      summary: source ? `Source set to ${source}` : "Source cleared",
    },
  });

  return updated;
}
