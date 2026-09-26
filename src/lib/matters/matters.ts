import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { ROLES, type Role } from "@/lib/auth/roles";
import { logActivity } from "./activity";
import { type MatterStatus, isMatterStatus } from "./status";
import type { FilingBasis } from "./ip-fields";
import { type MatterStage, listMatterStages } from "./stages";

/** The crm_matter row exactly as the table stores it. */
export type MatterRow = Database["public"]["Tables"]["crm_matter"]["Row"];

/**
 * A matter as the read surfaces consume it: the row plus the docket stage its
 * `stage_id` points at, resolved for them.
 *
 * `stage` is null for a matter that is not on the docket yet — 0042 made
 * stage_id nullable precisely so an unplaced matter stays visibly unplaced
 * rather than being stamped into a guessed stage, and every renderer must keep
 * showing it that way.
 *
 * The join is done in memory rather than as a PostgREST embed: a firm has ~42
 * stages, so one extra scoped SELECT serves a whole page of matters and the
 * embed's shape (which varies with how PostgREST resolves the composite FK)
 * never leaks into the type.
 */
export type Matter = MatterRow & { stage: MatterStage | null };

export type MatterFilter = {
  status?: string;
  leadId?: string;
};

/**
 * Roles allowed to write matters (create / change status). Mirrors
 * requireLeadWriteRole in src/app/(firm)/dashboard/leads/[id]/actions.ts and
 * the crm_matter_insert_staff / crm_matter_update_staff RLS policies
 * (supabase/migrations/0019_matter_activity.sql): every staff role EXCEPT
 * social_media and viewer. This is the single shared gate for the whole
 * matters lib (matters.ts/activity.ts/tasks.ts) — RLS is the real boundary
 * and must never diverge from this list without updating both.
 */
export const MATTER_WRITE_ROLES: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the signed-in caller's role within their active org via the
 * `current_org_role()` RPC (same JWT-claim-backed helper RLS policies use;
 * see supabase/migrations/0002_rls.sql) and checks it against
 * MATTER_WRITE_ROLES. Throws (fail closed) if the caller has no resolvable
 * role or an insufficient one. Shared by matters.ts, activity.ts, and
 * tasks.ts — re-resolved on every call, never cached across calls.
 */
export async function requireMatterWriteRole(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data)) {
    throw new Error("You don't have permission to edit matters.");
  }
  if (!MATTER_WRITE_ROLES.includes(data)) {
    throw new Error(`Forbidden: role '${data}' cannot write matters`);
  }
  return data;
}

/**
 * Attaches each row's docket stage. One scoped SELECT for the whole batch (a
 * firm has ~42 stages), skipped entirely when nothing in the batch is staged.
 * A stage_id that resolves to nothing yields `stage: null` — the same honest
 * "not on the docket" the UI already renders — rather than throwing.
 */
async function withStages(rows: MatterRow[]): Promise<Matter[]> {
  if (rows.length === 0) return [];
  if (!rows.some((r) => r.stage_id)) return rows.map((r) => ({ ...r, stage: null }));

  const stages = await listMatterStages();
  const byId = new Map(stages.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, stage: (r.stage_id && byId.get(r.stage_id)) || null }));
}

/**
 * Lists matters in the active org, optionally filtered by status or lead, with
 * each matter's docket stage resolved. RLS scopes rows to the caller's org.
 * Newest first (by created_at).
 */
export async function listMatters(filter: MatterFilter = {}): Promise<Matter[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_matter").select("*");

  if (filter.status) {
    query = query.eq("status", filter.status);
  }
  if (filter.leadId) {
    query = query.eq("lead_id", filter.leadId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return withStages(data ?? []);
}

/**
 * Fetches a single matter (stage resolved) by id, or null if not found / not
 * visible under RLS.
 */
export async function getMatter(id: string): Promise<Matter | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_matter")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await withStages([data]))[0] ?? null;
}

/**
 * The trademark/copyright file fields 0035 added to crm_matter, grouped the way
 * the UI groups them (Identification / Filing / Examination). Every one is
 * optional and every one stores NULL when absent — a matter with no serial
 * number yet has no serial number, not a placeholder.
 */
export type MatterIpFields = {
  markText?: string | null;
  serialNumber?: string | null;
  registrationNumber?: string | null;
  filingBasis?: FilingBasis | null;
  filingDate?: string | null;
  registrationDate?: string | null;
  internationalClasses?: number[] | null;
  goodsServices?: string | null;
  examiningAttorney?: string | null;
  usptoStatus?: string | null;
  usptoStatusAsOf?: string | null;
};

export type CreateMatterInput = MatterIpFields & {
  type: MatterRow["type"];
  leadId?: string;
  title?: string;
  packageName?: string;
  matterNumber?: string;
};

/**
 * Maps the camelCase input onto the column names, omitting any key the caller
 * did not supply. `undefined` means "leave this column alone"; an explicit
 * `null` means "clear it" — the distinction matters for a partial edit form.
 */
function ipColumns(input: MatterIpFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Array<[keyof MatterIpFields, string]> = [
    ["markText", "mark_text"],
    ["serialNumber", "serial_number"],
    ["registrationNumber", "registration_number"],
    ["filingBasis", "filing_basis"],
    ["filingDate", "filing_date"],
    ["registrationDate", "registration_date"],
    ["internationalClasses", "international_classes"],
    ["goodsServices", "goods_services"],
    ["examiningAttorney", "examining_attorney"],
    ["usptoStatus", "uspto_status"],
    ["usptoStatusAsOf", "uspto_status_as_of"],
  ];
  for (const [key, column] of map) {
    if (input[key] !== undefined) out[column] = input[key];
  }
  return out;
}

/**
 * Creates a matter. Staff-role-gated (see MATTER_WRITE_ROLES).
 * When matterNumber is omitted, generates `${type}-${year}-${4-digit}`,
 * derived from the current count of the org's matters + 1, zero-padded
 * (e.g. TM-2026-0001). The (org_id, matter_number) unique constraint is the
 * real guard against a race producing a duplicate — this is a best-effort
 * generator, not a reservation.
 */
export async function createMatter(input: CreateMatterInput): Promise<MatterRow> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  // org_id is the caller's active org (never taken from the input). RLS's
  // with-check also requires it to equal current_org_id(), so this is the
  // single source of truth for the new matter's tenant.
  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new Error("No active organization for the current session.");

  let matterNumber = input.matterNumber;
  if (!matterNumber) {
    const { count, error: countError } = await supabase
      .from("crm_matter")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;
    const next = (count ?? 0) + 1;
    const year = new Date().getFullYear();
    matterNumber = `${input.type}-${year}-${String(next).padStart(4, "0")}`;
  }

  const { data, error } = await supabase
    .from("crm_matter")
    .insert({
      org_id: orgId,
      type: input.type,
      lead_id: input.leadId ?? null,
      title: input.title ?? null,
      package_name: input.packageName ?? null,
      matter_number: matterNumber,
      ...ipColumns(input),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Updates the trademark/copyright file fields on a matter. Staff-gated, stamps
 * updated_at, and logs a matter_updated activity naming which fields changed
 * (values are not copied into the timeline — the row is the record).
 *
 * Only keys present on the input are written, so a form that renders one group
 * cannot blank the others.
 */
export async function updateMatterIpFields(
  id: string,
  fields: MatterIpFields,
): Promise<MatterRow> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const columns = ipColumns(fields);
  if (Object.keys(columns).length === 0) {
    const existing = await getMatter(id);
    if (!existing) throw new Error("Matter not found.");
    return existing;
  }

  const { data, error } = await supabase
    .from("crm_matter")
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await logActivity({
    type: "matter_updated",
    matterId: id,
    payload: { change: "ip_fields", fields: Object.keys(columns) },
  });

  return data;
}

const PA_TO_MATTER_TYPE: Record<string, MatterRow["type"]> = {
  "PA-TM": "TM",
  "PA-PATENT": "PATENT",
  "PA-COPYRIGHT": "CR",
};

/**
 * Idempotently opens a matter for a lead that has reached a "won" stage — the
 * pipeline→matter handoff. No-ops (returns null) if the lead already has a
 * matter, so re-entering the Hired stage never creates duplicates. The matter
 * type is inferred from the lead's PA (practice-area) tag (PA-TM→TM,
 * PA-PATENT→PATENT, PA-COPYRIGHT→CR), defaulting to TM; the title defaults to
 * the lead's business_name or full name. Logs a matter_opened activity.
 * Called from moveLeadStage (src/lib/pipeline/leads.ts) on a category-'won' move.
 */
export async function ensureMatterForLead(leadId: string): Promise<MatterRow | null> {
  const supabase = await getScopedClient();

  const { data: existing, error: existingError } = await supabase
    .from("crm_matter")
    .select("id")
    .eq("lead_id", leadId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return null;

  const { data: lead, error: leadError } = await supabase
    .from("crm_lead")
    .select("first_name, last_name, business_name")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return null;

  // Infer practice area from the lead's PA tag(s); default TM.
  let type: MatterRow["type"] = "TM";
  const { data: leadTags } = await supabase
    .from("crm_lead_tag")
    .select("tag_id")
    .eq("lead_id", leadId);
  const tagIds = (leadTags ?? []).map((t) => t.tag_id);
  if (tagIds.length) {
    const { data: paTags } = await supabase
      .from("crm_tag")
      .select("code")
      .eq("dimension", "PA")
      .in("id", tagIds);
    const code = paTags?.[0]?.code;
    if (code && PA_TO_MATTER_TYPE[code]) type = PA_TO_MATTER_TYPE[code];
  }

  const title =
    lead.business_name?.trim() || `${lead.first_name} ${lead.last_name}`.trim();
  const matter = await createMatter({ type, leadId, title });

  await logActivity({
    type: "matter_opened",
    leadId,
    matterId: matter.id,
    payload: { matter_number: matter.matter_number, auto: true, source: "hired_stage" },
  });

  return matter;
}

/**
 * Updates a matter's lifecycle status. Staff-gated, stamps updated_at.
 *
 * `status` is checked against the defined vocabulary (src/lib/matters/status.ts,
 * mirroring 0035's crm_matter_status_vocab CHECK) before it reaches the DB, so
 * a bad value gets a readable refusal instead of a constraint violation. This
 * is the matter LIFECYCLE — the office's prosecution status is a separate
 * field (uspto_status) and does not belong here.
 */
export async function updateMatterStatus(id: string, status: MatterStatus): Promise<MatterRow> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  if (!isMatterStatus(status)) {
    throw new Error(`'${status}' isn't a valid matter status.`);
  }

  const { data, error } = await supabase
    .from("crm_matter")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Updates a matter's free-text staff notes. Staff-role-gated (see
 * MATTER_WRITE_ROLES), stamps updated_at. No `logActivity()` call — mirrors
 * saveTeamStatusNote's (src/lib/matters/team-status-note.ts) precedent of
 * skipping activity logging for a frequent, low-signal free-text field; the
 * row itself is the record.
 *
 * `notes` is also the field the matters Lawmatics importer can backfill
 * (src/lib/lawmatics/matters-import-plan.ts), but only when it is currently
 * null/blank here — a staff-entered note always wins.
 */
export async function updateMatterNotes(id: string, notes: string | null): Promise<MatterRow> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data, error } = await supabase
    .from("crm_matter")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Reassigns (or unassigns, with null) a matter's staff owner — "whose court
 * the ball is in", the exact gap the Aug 19 team meeting exists to paper over
 * by hand. Mirrors assignLead (src/lib/pipeline/leads.ts) exactly: staff-role-
 * gated, and only a REAL change gets a timeline row so re-submitting the same
 * teammate doesn't add noise. RLS (crm_matter_update_staff, 0019) is the real
 * boundary; requireMatterWriteRole here is the friendly refusal.
 */
export async function assignMatterOwner(id: string, userId: string | null): Promise<MatterRow> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: before } = await supabase
    .from("crm_matter")
    .select("assigned_to")
    .eq("id", id)
    .maybeSingle();
  const fromUserId = before?.assigned_to ?? null;

  const { data, error } = await supabase
    .from("crm_matter")
    .update({ assigned_to: userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  if (fromUserId !== (userId ?? null)) {
    await logActivity({
      type: "matter_updated",
      matterId: id,
      payload: { change: "owner_assigned", from_user_id: fromUserId, to_user_id: userId ?? null },
    });
  }

  return data;
}
