import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import type { Role } from "@/lib/auth/roles";
import { ROLES } from "@/lib/auth/roles";
import { ensureMatterForLead, logActivitySafe } from "@/lib/matters";
import { runRules } from "@/lib/automation";
import {
  diffLeadColumns,
  validateLeadEdit,
  validateNewLead,
  type LeadContactInput,
  type LeadFieldErrors,
} from "./lead-input";
import { LeadWriteError, forbiddenLeadWrite } from "./errors";
import { notifyAssigned } from "@/lib/notifications/producers";

export type Lead = Database["public"]["Tables"]["crm_lead"]["Row"];

export type LeadFilter = {
  stageId?: string;
  assignedTo?: string;
  search?: string;
};

/**
 * Roles allowed to advance a lead's pipeline stage. Deliberately NOT a simple
 * `hasRole` rank threshold — paralegal sits above social_media/viewer in the
 * overall rank order but is explicitly blocked from moving stages (mirrors the
 * `move_lead_stage` guard in rpblaw-crm's TOOL_PERMISSIONS). paralegal CAN
 * still edit lead fields via assignLead / other lead writes; this only gates
 * moveLeadStage.
 */
export const CAN_MOVE_STAGE: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "law_clerk",
  "attorney",
  "clerk",
];

/**
 * Roles allowed to create or edit a lead record. Mirrors the
 * crm_lead_insert_staff / crm_lead_update_staff RLS policies
 * (supabase/migrations/0016_pipeline.sql) exactly: every staff role EXCEPT
 * social_media and viewer. RLS is the real boundary — this list exists so a
 * refusal comes back as a friendly message instead of a raw Postgres error,
 * and must never diverge from the policy without updating both.
 */
export const CAN_WRITE_LEAD: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
];

function isRole(value: string | null | undefined): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Resolves the signed-in caller's role within their active org via the
 * `current_org_role()` RPC — the same JWT-claim-backed helper RLS policies use
 * (see supabase/migrations/0002_rls.sql). Throws if the caller has no
 * resolvable role (no active org membership) so callers fail closed.
 *
 * Always re-resolved per call. Nothing here is memoised across calls: a role
 * revoked between two requests must take effect on the very next one.
 */
export async function resolveCurrentRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data)) {
    throw new LeadWriteError("Forbidden: no resolvable role for the active org", {
      forbidden: true,
    });
  }
  return data;
}

/** Role gate for lead create/edit. Re-resolves the role on every call. */
async function requireLeadWriteRole(supabase: ScopedClient): Promise<Role> {
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw forbiddenLeadWrite(role, "create or edit leads");
  }
  return role;
}

/** Turns a failed pure validation into the single error the actions understand. */
function inputError(fieldErrors: LeadFieldErrors): LeadWriteError {
  const first = Object.values(fieldErrors)[0] ?? "Check the lead details.";
  return new LeadWriteError(first, { fieldErrors: fieldErrors as Record<string, string> });
}

/**
 * Lists leads in the active org, optionally filtered by stage, assignee, or a
 * name/email/business_name search term. RLS scopes rows to the caller's org.
 */
export async function listLeads(filter: LeadFilter = {}): Promise<Lead[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_lead").select("*");

  if (filter.stageId) {
    query = query.eq("current_stage_id", filter.stageId);
  }
  if (filter.assignedTo) {
    query = query.eq("assigned_to", filter.assignedTo);
  }
  if (filter.search) {
    const term = filter.search.trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},business_name.ilike.${like}`,
      );
    }
  }

  const { data, error } = await query.order("last_activity_at", {
    ascending: false,
    nullsFirst: false,
  });
  if (error) throw error;
  return data ?? [];
}

/** Fetches a single lead by id, or null if not found / not visible under RLS. */
export async function getLead(id: string): Promise<Lead | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_lead")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type CreateLeadInput = LeadContactInput & {
  /** Defaults to the tenant's lowest `order_index` stage when omitted. */
  currentStageId?: string | null;
  assignedTo?: string | null;
  /** Provenance for the audit row — a human at the dashboard unless stated. */
  source?: string;
};

/**
 * Creates a lead in the caller's active org — the CRM's front door. Every
 * other lead surface in the product reads rows this function wrote.
 *
 * Role-gated on every call (CAN_WRITE_LEAD, re-resolved via current_org_role()
 * — never cached), org-scoped through getScopedClient so RLS is the real
 * boundary, and input-validated by the same pure rules the form uses.
 *
 * `current_stage_id` defaults to the tenant's lowest `order_index` stage: a
 * firm's first column, whatever they named it — never a hardcoded stage.
 */
export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const supabase = await getScopedClient();
  await requireLeadWriteRole(supabase);

  const validated = validateNewLead(input);
  if (!validated.ok) throw inputError(validated.fieldErrors);

  // org_id is the caller's active org, never taken from the input. RLS's
  // WITH CHECK requires it to equal current_org_id() anyway, so this is the
  // single source of truth for the new lead's tenant.
  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new LeadWriteError("No active organization for the current session.");

  let stageId = input.currentStageId ?? null;
  if (!stageId) {
    // RLS already scopes crm_stage to the active org, so "first stage" means
    // this tenant's first stage.
    const { data: firstStage, error: stageError } = await supabase
      .from("crm_stage")
      .select("id")
      .order("order_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (stageError) throw stageError;
    if (!firstStage) {
      throw new LeadWriteError(
        "This firm has no pipeline stages yet — an owner or admin needs to set them up in Settings first.",
      );
    }
    stageId = firstStage.id;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_lead")
    .insert({
      org_id: orgId,
      ...validated.value,
      current_stage_id: stageId,
      assigned_to: input.assignedTo || null,
      stage_entered_at: now,
      last_activity_at: now,
    })
    .select("*")
    .single();
  if (error) throw error;

  // Audit AFTER the insert: see logActivitySafe's contract in
  // src/lib/matters/activity.ts — the write is authoritative, the timeline row
  // is best-effort and can never roll it back.
  await logActivitySafe({
    type: "lead_created",
    leadId: data.id,
    payload: {
      summary: `${data.first_name} ${data.last_name}`.trim(),
      email: data.email,
      business_name: data.business_name,
      stage_id: data.current_stage_id,
      assigned_to: data.assigned_to,
      source: input.source ?? "dashboard",
    },
  });

  // Automation trigger: lets admin-defined rules react to a new lead (apply a
  // tag, assign an intake task, enroll a drip, ...). Best-effort — runRules
  // never throws, but the catch is kept so a future change to it can't regress
  // the creation it's attached to.
  try {
    await runRules("lead_created", { leadId: data.id, stageId: data.current_stage_id });
  } catch {
    // swallow: the lead already exists.
  }

  return data;
}

export type UpdateLeadInput = LeadContactInput;

/**
 * Edits a lead's contact fields — the only path by which a wrong client email
 * or phone number can be corrected in the product.
 *
 * Role-gated per call like createLead. Only the keys the caller supplied are
 * written, so a partial patch never blanks a column the form didn't render,
 * and an edit that changes nothing is a no-op (no write, no audit row).
 */
export async function updateLead(id: string, input: UpdateLeadInput): Promise<Lead> {
  const supabase = await getScopedClient();
  await requireLeadWriteRole(supabase);

  const validated = validateLeadEdit(input);
  if (!validated.ok) throw inputError(validated.fieldErrors);

  const { data: before, error: beforeError } = await supabase
    .from("crm_lead")
    .select("first_name, last_name, email, phone, business_name, website")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) throw new LeadWriteError("That lead no longer exists.");

  const changes = diffLeadColumns(before, validated.value);
  if (Object.keys(changes).length === 0) {
    const current = await getLead(id);
    if (!current) throw new LeadWriteError("That lead no longer exists.");
    return current;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_lead")
    .update({ ...validated.value, updated_at: now, last_activity_at: now })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await logActivitySafe({
    type: "lead_updated",
    leadId: id,
    payload: {
      summary: `Updated ${Object.keys(changes).join(", ").replace(/_/g, " ")}`,
      changes,
    },
  });

  return data;
}

/**
 * Moves a lead to a new stage. Role-gated: paralegal, social_media, and
 * viewer are rejected even though some of them can otherwise edit leads.
 * Also stamps stage_entered_at and last_activity_at to now.
 */
export async function moveLeadStage(id: string, stageId: string): Promise<Lead> {
  const supabase = await getScopedClient();

  const role = await resolveCurrentRole(supabase);
  if (!CAN_MOVE_STAGE.includes(role)) {
    throw forbiddenLeadWrite(role, "move lead stage");
  }

  // Captured before the update so the audit row can name where the lead came
  // from. Best-effort: a missing prior stage id must not block the move.
  const { data: before } = await supabase
    .from("crm_lead")
    .select("current_stage_id")
    .eq("id", id)
    .maybeSingle();
  const fromStageId = before?.current_stage_id ?? null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_lead")
    .update({
      current_stage_id: stageId,
      stage_entered_at: now,
      last_activity_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // Stage names make the timeline readable ("New PNC → Discovery Call")
  // instead of a pair of uuids; ids are kept in the payload regardless so the
  // record survives a stage being renamed or deleted later.
  const stageNames = await stageNameMap(
    supabase,
    [fromStageId, stageId].filter((v): v is string => !!v),
  );
  await logActivitySafe({
    type: "stage_changed",
    leadId: id,
    payload: {
      from_stage: fromStageId ? (stageNames[fromStageId] ?? null) : null,
      to_stage: stageNames[stageId] ?? null,
      from_stage_id: fromStageId,
      to_stage_id: stageId,
    },
  });

  // Pipeline→matter handoff: opening a matter when a lead reaches a "won"
  // stage (e.g. "Hired Client"). Keyed on the stage's CATEGORY, not its name,
  // so a firm can rename the stage and this still fires. Best-effort and
  // idempotent (ensureMatterForLead no-ops if a matter already exists) — a
  // failure here must never roll back the stage move the user explicitly made.
  try {
    const { data: destStage } = await supabase
      .from("crm_stage")
      .select("category")
      .eq("id", stageId)
      .maybeSingle();
    if (destStage?.category === "won") {
      await ensureMatterForLead(id);
    }
  } catch {
    // swallow: the stage move already succeeded; the matter can be opened
    // manually or on a subsequent move.
  }

  // Automation trigger: lets admin-defined rules react to stage changes
  // (apply a tag, assign a task, enroll a drip, ...). Best-effort and
  // independent of the matter handoff above — runRules never throws, but
  // this catch is kept anyway so a future change to runRules can't
  // regress the stage move it's attached to.
  try {
    await runRules("stage_changed", { leadId: id, stageId });
  } catch {
    // swallow: the stage move already succeeded.
  }

  return data;
}

/** Best-effort id→name lookup for stages; never throws, missing ids are absent. */
async function stageNameMap(
  supabase: ScopedClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    const { data } = await supabase.from("crm_stage").select("id, name").in("id", ids);
    return Object.fromEntries((data ?? []).map((s) => [s.id, s.name]));
  } catch {
    return {};
  }
}

/**
 * Reassigns (or unassigns, with null) a lead.
 *
 * Note: unlike create/edit/move this has no self-gate — the app-layer check
 * lives in the lead-detail server action (requireLeadWriteRole there) and RLS
 * is the boundary. Left as-is deliberately; changing it is a separate call.
 */
export async function assignLead(id: string, userId: string | null): Promise<Lead> {
  const supabase = await getScopedClient();

  const { data: before } = await supabase
    .from("crm_lead")
    .select("assigned_to")
    .eq("id", id)
    .maybeSingle();
  const fromUserId = before?.assigned_to ?? null;

  const { data, error } = await supabase
    .from("crm_lead")
    .update({ assigned_to: userId })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // Only record a real change — re-submitting the assign form with the same
  // teammate selected shouldn't add a timeline row.
  if (fromUserId !== (userId ?? null)) {
    await logActivitySafe({
      type: "lead_assigned",
      leadId: id,
      payload: {
        // TODO(member-identity): render names once the member-identity lookup
        // RPC another agent is building lands; until then the timeline shows
        // the raw ids that are stored here.
        from_user_id: fromUserId,
        to_user_id: userId ?? null,
        summary: userId ? "Assigned to a teammate" : "Unassigned",
      },
    });

    // The bell (blueprint §13.3). Raised only for a real change, and only for
    // a real new owner — notify() itself drops the self-assignment case, so an
    // attorney picking up their own lead never hears about it.
    //
    // Wrapped even though notifyAssigned already swallows everything it can:
    // a failed notification must never fail an assignment, and that guarantee
    // should not depend on a module this one merely calls keeping its promise.
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await notifyAssigned(id, userId ?? null, user?.id ?? null);
    } catch {
      // swallow: the assignment already succeeded and is the record that matters.
    }
  }

  return data;
}
