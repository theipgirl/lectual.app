import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireAutomationAdminRole, requireAutomationStaffRole, currentOrgId } from "./rules";

export type DripSequence = Database["public"]["Tables"]["crm_drip_sequence"]["Row"];
export type DripStep = Database["public"]["Tables"]["crm_drip_step"]["Row"];
export type EmailTemplate = Database["public"]["Tables"]["crm_email_template"]["Row"];
export type DripEnrollment = Database["public"]["Tables"]["crm_drip_enrollment"]["Row"];
type DripStepType = Database["public"]["Enums"]["crm_drip_step_type"];
type DripEnrollmentStatus = Database["public"]["Enums"]["crm_drip_enrollment_status"];

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
 * Enrolls a lead into a drip sequence. Staff-gated (see
 * AUTOMATION_STAFF_ROLES in ./rules). org_id is read off the lead row
 * (denormalized, matching RLS's own requirement) — never taken from the
 * caller. Idempotent on the unique(lead_id, sequence_id) constraint: a
 * duplicate enroll returns the existing enrollment rather than throwing.
 */
export async function enrollLead(leadId: string, sequenceId: string): Promise<DripEnrollment> {
  const supabase = await getScopedClient();
  await requireAutomationStaffRole(supabase);

  const { data: lead, error: leadError } = await supabase
    .from("crm_lead")
    .select("org_id")
    .eq("id", leadId)
    .single();
  if (leadError) throw leadError;

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
      return existing;
    }
    throw error;
  }
  return data;
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
