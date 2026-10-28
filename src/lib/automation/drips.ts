import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireAutomationAdminRole, requireAutomationStaffRole, currentOrgId } from "./rules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { clientFact, enrollRefusal, stopLine, type StopReason } from "@/lib/campaigns/stops";
import { loadClientLeads, loadStopFactsForPerson, type ClientLeadsRead } from "@/lib/campaigns/stop-facts";
import { stopLeadSequences } from "@/lib/campaigns/stop";
import { sessionUserId } from "@/lib/campaigns/stop-staff";
import type { StopDb } from "@/lib/campaigns/stop-db";
import { ReadableError } from "@/lib/ui/readable-error";


export type DripSequence = Database["public"]["Tables"]["crm_drip_sequence"]["Row"];
export type DripStep = Database["public"]["Tables"]["crm_drip_step"]["Row"];
export type EmailTemplate = Database["public"]["Tables"]["crm_email_template"]["Row"];
export type DripEnrollment = Database["public"]["Tables"]["crm_drip_enrollment"]["Row"];
// Exported so callers (the campaigns UI's step-type picker, enrollment status
// labels — see src/lib/campaigns/steps.ts) don't reach into Database directly.
export type DripStepType = Database["public"]["Enums"]["crm_drip_step_type"];
export type DripEnrollmentStatus = Database["public"]["Enums"]["crm_drip_enrollment_status"];

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "23505";
}

// ── Sequences (admin-managed) ────────────────────────────────────────────────

/** Lists the active org's drip sequences. RLS scopes rows to the caller's org — not role-gated (read). */
export async function listSequences(): Promise<DripSequence[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_drip_sequence")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Fetches a single sequence by id, or null if not found / not visible under RLS. */
export async function getSequence(id: string): Promise<DripSequence | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_drip_sequence")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type CreateSequenceInput = { name: string; description?: string; active?: boolean };

/** Creates a drip sequence. Admin-gated (owner/admin/senior_admin). */
export async function createSequence(input: CreateSequenceInput): Promise<DripSequence> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const { data, error } = await supabase
    .from("crm_drip_sequence")
    .insert({
      org_id: orgId,
      name: input.name,
      description: input.description ?? "",
      active: input.active ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type UpdateSequenceInput = { name: string; description?: string };

/** Updates a sequence's name/description (not its active flag — see toggleSequenceActive). Admin-gated. */
export async function updateSequenceDetails(id: string, input: UpdateSequenceInput): Promise<DripSequence> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_drip_sequence")
    .update({ name: input.name, description: input.description ?? "", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Flips a sequence's active flag ("pause" / "start"). Admin-gated. */
export async function toggleSequenceActive(id: string, active: boolean): Promise<DripSequence> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_drip_sequence")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ── Steps (admin-managed; org_id denormalized from the sequence) ────────────

/** Lists a sequence's steps in order. RLS scopes rows to the caller's org — not role-gated (read). */
export async function listSteps(sequenceId: string): Promise<DripStep[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_drip_step")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type AddStepInput = {
  orderIndex: number;
  type: DripStepType;
  delayHours?: number;
  templateId?: string | null;
  config?: Record<string, unknown>;
};

/**
 * Appends (or inserts at a given order_index) a step onto a sequence.
 * Admin-gated. org_id is the caller's active org, matching the sequence's
 * own org under RLS's with-check — never taken from the caller.
 */
export async function addStep(sequenceId: string, input: AddStepInput): Promise<DripStep> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const { data, error } = await supabase
    .from("crm_drip_step")
    .insert({
      org_id: orgId,
      sequence_id: sequenceId,
      order_index: input.orderIndex,
      type: input.type,
      delay_hours: input.delayHours ?? 0,
      template_id: input.templateId ?? null,
      config: (input.config ?? {}) as Database["public"]["Tables"]["crm_drip_step"]["Insert"]["config"],
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Removes a step from a sequence. Admin-gated.
 *
 * `crm_drip_enrollment.current_step` counts steps already run, not a
 * foreign key to one — so deleting (or adding) a step ahead of an
 * in-flight enrollment shifts which step it hits next, same as it would for
 * a step inserted at an earlier order_index. That is a real edit to a live
 * sequence, not a bug in this function; the caller (the sequence builder UI)
 * is expected to only let an admin do this deliberately.
 */
export async function deleteStep(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { error } = await supabase.from("crm_drip_step").delete().eq("id", id);
  if (error) throw error;
}

// ── Email templates (admin-managed) ──────────────────────────────────────────

/** Lists the active org's email templates. RLS scopes rows to the caller's org — not role-gated (read). */
export async function listTemplates(): Promise<EmailTemplate[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_email_template")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type CreateTemplateInput = {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  variables?: string[];
};

/** Creates an email template. Admin-gated (owner/admin/senior_admin). */
export async function createTemplate(input: CreateTemplateInput): Promise<EmailTemplate> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const { data, error } = await supabase
    .from("crm_email_template")
    .insert({
      org_id: orgId,
      name: input.name,
      subject: input.subject,
      body_html: input.bodyHtml,
      body_text: input.bodyText ?? "",
      variables: (input.variables ?? []) as unknown as Database["public"]["Tables"]["crm_email_template"]["Insert"]["variables"],
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ── Enrollments (operational; staff-gated) ───────────────────────────────────

export type EnrollmentFilter = {
  sequenceId?: string;
  leadId?: string;
  status?: DripEnrollmentStatus;
};

/** Lists drip enrollments, optionally filtered. RLS scopes rows to the caller's org — not role-gated (read). */
export async function listEnrollments(filter: EnrollmentFilter = {}): Promise<DripEnrollment[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_drip_enrollment").select("*");

  if (filter.sequenceId) query = query.eq("sequence_id", filter.sequenceId);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);
  if (filter.status) query = query.eq("status", filter.status);

  const { data, error } = await query.order("enrolled_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Which of these leads `enrollLead` would refuse as already a client, for a whole
 * list in one batched read (the campaign page's "Enroll a lead" picker leaves them
 * out). The verdict is the same one `enrollLead` reaches, from the same stop facts
 * — see `loadClientLeads`. Not role-gated (a read, RLS-scoped); this is only a
 * convenience for the picker and `enrollLead` stays the guard. A failed read is
 * `unavailable`, never "no clients".
 */
export async function findClientLeads(leadIds: readonly string[]): Promise<ClientLeadsRead> {
  const supabase = await getScopedClient();
  return loadClientLeads(supabase as unknown as StopDb, { leadIds });
}

/**
 * Enrolls a lead into a drip sequence. Staff-gated (see
 * AUTOMATION_STAFF_ROLES in ./rules). org_id is read off the lead row
 * (denormalized, matching RLS's own requirement) — never taken from the
 * caller. Idempotent on the unique(lead_id, sequence_id) constraint: a
 * duplicate enroll returns the existing enrollment rather than throwing —
 * unless that enrollment was STOPPED, which is final and is said so.
 *
 * REFUSES A CLIENT (intake SOP Stage 3: "is already a client" is a stop). A
 * lead with a signed quote, a recorded payment, a matter or a won stage is
 * not enrolled (nor is one whose same-address duplicate lead row is), and
 * the refusal names the fact and its date. If those facts
 * can't be read, nothing is enrolled either — the same fail-closed rule the
 * advance() guard follows.
 */
export async function enrollLead(leadId: string, sequenceId: string): Promise<DripEnrollment> {
  const supabase = await getScopedClient();
  await requireAutomationStaffRole(supabase);

  const { data: lead, error: leadError } = await supabase
    .from("crm_lead")
    .select("org_id, first_name, last_name, business_name")
    .eq("id", leadId)
    .single();
  if (leadError) throw leadError;

  const facts = await loadStopFactsForPerson(supabase as unknown as StopDb, { leadId });
  if (facts.status !== "ok") {
    throw new ReadableError("Couldn't confirm this lead isn't already a client, so nothing was enrolled. Try again shortly.");
  }
  const client = clientFact(facts.facts);
  if (client) {
    const name = lead.business_name?.trim() || `${lead.first_name} ${lead.last_name}`.trim() || "This lead";
    throw new ReadableError(enrollRefusal(name, client, await getFirmTimeZone()));
  }

  const { data, error } = await supabase
    .from("crm_drip_enrollment")
    .insert({ org_id: lead.org_id, lead_id: leadId, sequence_id: sequenceId })
    .select("*")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing, error: existingError } = await supabase
        .from("crm_drip_enrollment")
        .select("*")
        .eq("lead_id", leadId)
        .eq("sequence_id", sequenceId)
        .single();
      if (existingError) throw existingError;
      if (existing.status === "stopped") {
        throw new ReadableError(
          `${stopLine({ reason: existing.stop_reason, at: existing.stopped_at }, await getFirmTimeZone())}. A stopped campaign can't be restarted for the same lead.`,
        );
      }
      return existing;
    }
    throw error;
  }

  // The lead's timeline says it entered the campaign. Best effort.
  const { data: seq } = await supabase.from("crm_drip_sequence").select("name").eq("id", sequenceId).maybeSingle();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error: actError } = await supabase.from("crm_activity").insert({
    org_id: lead.org_id,
    lead_id: leadId,
    type: "drip_enrolled",
    actor_type: "user",
    actor_id: user?.id ?? null,
    payload: { enrollment_id: data.id, sequence_id: sequenceId, sequence_name: seq?.name ?? null },
  });
  if (actError) console.error("[campaigns] enrolled but the timeline row failed", actError.code);
  return data;
}

/**
 * A person stops an enrollment by hand ("Stop sequence"), with the reason they
 * pick — manual, or a fact the software cannot detect (they asked us to stop,
 * they booked a call, they replied somewhere the mailbox sync doesn't read).
 * Staff-gated like every enrollment write; the 0085 trigger stamps who and
 * when, and makes it final. The org comes from the enrollment row via RLS.
 */
export async function stopEnrollment(id: string, reason: StopReason): Promise<DripEnrollment> {
  const supabase = await getScopedClient();
  await requireAutomationStaffRole(supabase);
  const { data: current, error: readError } = await supabase
    .from("crm_drip_enrollment")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new ReadableError("That enrollment couldn't be found. Refresh and try again.");
  if (current.status !== "active" && current.status !== "paused") {
    throw new ReadableError(`This enrollment is already ${current.status}.`);
  }
  const outcome = await stopLeadSequences(supabase as unknown as StopDb, {
    orgId: current.org_id,
    leadIds: [current.lead_id],
    enrollmentIds: [id],
    reason,
    actor: { type: "user", id: await sessionUserId(supabase) },
    evidence: { by_hand: true },
  });
  if (outcome.status !== "ok") throw new ReadableError("Couldn't stop this campaign. Try again shortly.");
  const { data: after, error } = await supabase.from("crm_drip_enrollment").select("*").eq("id", id).single();
  if (error) throw error;
  return after;
}

export type LeadEnrollment = DripEnrollment & { sequence_name: string | null };

/** One lead's enrollments with their campaign names, newest first. RLS-scoped; throws on a failed read. */
export async function listLeadEnrollments(leadId: string): Promise<LeadEnrollment[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_drip_enrollment")
    .select("*")
    .eq("lead_id", leadId)
    .order("enrolled_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: seqs, error: seqError } = await supabase
    .from("crm_drip_sequence")
    .select("id, name")
    .in("id", [...new Set(rows.map((r) => r.sequence_id))]);
  if (seqError) throw seqError;
  const names = new Map((seqs ?? []).map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, sequence_name: names.get(r.sequence_id) ?? null }));
}

/** Updates a drip enrollment's status. Staff-gated. Stamps completed_at only when transitioning to 'completed'. */
export async function setEnrollmentStatus(
  id: string,
  status: DripEnrollmentStatus,
): Promise<DripEnrollment> {
  const supabase = await getScopedClient();
  await requireAutomationStaffRole(supabase);

  const patch: Database["public"]["Tables"]["crm_drip_enrollment"]["Update"] = { status };
  if (status === "completed") patch.completed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("crm_drip_enrollment")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
