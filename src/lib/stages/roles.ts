/**
 * Stage ROLES (lectual 0119, spec-editable-views.md section 3b rule 4): a fixed tag on a stage that a RULE reads instead of the stage's
 * name, so a rename or a reorder changes nothing a rule does. Pure: no client, no server-only import.
 *
 * The role is set by 0119's back-fill and by Lectual, never typed in the app. Every rule that used to find a stage by its NAME now asks
 * here first and keeps today's name match as the fallback:
 *
 *   firm brain `stage_mapping` entry (where the rule has one)  ->  the stage holding the role  ->  today's name rule  ->  today's fallback
 *
 * Before 0119 is applied the column does not exist: a stage simply carries no role (`role` absent or null) and every rule behaves
 * exactly as it did. A role is only trusted on a stage its category (lead) or open / closed state (matter) allows: the database
 * refuses anything else (stage_role_category_mismatch), and a stage that somehow breaks it is ignored here, never acted on.
 */

/** The lead-stage roles 0119 knows (crm_stage_role_valid). */
export const LEAD_STAGE_ROLES = [
  "new_enquiry",
  "follow_up",
  "consult_scheduled",
  "consult_held",
  "questionnaire_sent",
  "proposal_sent",
  "follow_up_sent",
  "loe_sent",
  "welcome_sent",
  "opinion_letter_sent",
  "signed_loe",
  "lost",
] as const;
export type LeadStageRole = (typeof LEAD_STAGE_ROLES)[number];

/** The matter-stage roles 0119 knows (crm_matter_stage_role_valid). */
export const MATTER_STAGE_ROLES = ["signed_loe", "application_filed", "oa_issued", "awaiting_registration", "publication", "registered", "abandoned"] as const;
export type MatterStageRole = (typeof MATTER_STAGE_ROLES)[number];

/** Which lead-stage category each role may sit on (0119's role trigger). Roles not listed sit on any category. */
const LEAD_ROLE_CATEGORY: Partial<Record<LeadStageRole, string>> = {
  new_enquiry: "open",
  follow_up: "open",
  signed_loe: "won",
  lost: "lost",
};

/** Matter roles that sit on an OPEN stage (true) or a CLOSED one (false). */
const MATTER_ROLE_OPEN: Record<MatterStageRole, boolean> = {
  signed_loe: true,
  application_filed: true,
  oa_issued: true,
  awaiting_registration: true,
  publication: true,
  registered: false,
  abandoned: false,
};

export function isLeadStageRole(value: unknown): value is LeadStageRole {
  return typeof value === "string" && (LEAD_STAGE_ROLES as readonly string[]).includes(value);
}

export function isMatterStageRole(value: unknown): value is MatterStageRole {
  return typeof value === "string" && (MATTER_STAGE_ROLES as readonly string[]).includes(value);
}

/** May a lead stage of this category hold this role? */
export function leadRoleFitsCategory(role: LeadStageRole, category: string | null | undefined): boolean {
  const wanted = LEAD_ROLE_CATEGORY[role];
  return wanted === undefined || wanted === category;
}

/** May a matter stage that is open (or closed) hold this role? */
export function matterRoleFitsOpen(role: MatterStageRole, isOpen: boolean | null | undefined): boolean {
  return MATTER_ROLE_OPEN[role] === (isOpen !== false);
}

type RoleCarrier = { role?: string | null };

/**
 * The ONE lead stage holding `role`, or null. Null when no stage holds it, when the stage holding it has a category the role may not
 * sit on, or when two stages claim it (0119's unique index forbids that; a hand-built list that breaks it is a guess, and a guess is
 * not a role). A null answer means "use today's name rule".
 */
export function leadStageWithRole<T extends RoleCarrier & { category?: string | null }>(stages: readonly T[], role: LeadStageRole): T | null {
  const holders = stages.filter((s) => s.role === role);
  if (holders.length !== 1) return null;
  return leadRoleFitsCategory(role, holders[0].category) ? holders[0] : null;
}

/** The ONE matter stage holding `role` on an open / closed state it allows, else null (today's label rule then applies). */
export function matterStageWithRole<T extends RoleCarrier & { is_open?: boolean | null }>(stages: readonly T[], role: MatterStageRole): T | null {
  const holders = stages.filter((s) => s.role === role);
  if (holders.length !== 1) return null;
  return matterRoleFitsOpen(role, holders[0].is_open) ? holders[0] : null;
}

/** Does ANY stage in the list claim this role (whether or not it fits)? A rule then stops trusting names that the role replaced. */
export function someStageHoldsRole(stages: readonly RoleCarrier[], role: string): boolean {
  return stages.some((s) => s.role === role);
}

/** The role a stage holds, when it is one this app knows; else null. */
export function leadRoleOf(stage: RoleCarrier | null | undefined): LeadStageRole | null {
  return isLeadStageRole(stage?.role) ? stage.role : null;
}

export function matterRoleOf(stage: RoleCarrier | null | undefined): MatterStageRole | null {
  return isMatterStageRole(stage?.role) ? stage.role : null;
}

/**
 * Postgres undefined_column (42703) or PostgREST's schema-cache miss (PGRST204), judged by CODE only. The one test every stage read
 * uses to fall back to its select without `role` on a database that has not got 0119.
 */
export function isMissingRoleColumn(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === "42703" || code === "PGRST204";
}

/**
 * Run a stage read with `role` in its select; when the database has no `role` column yet, run it again without. Any other error is
 * returned as it is (the caller's three states decide). `build(true)` must select role, `build(false)` the old columns.
 */
export async function withRoleFallback<R extends { error: unknown }>(build: (withRole: boolean) => PromiseLike<R>): Promise<R> {
  const first = await build(true);
  if (!first.error || !isMissingRoleColumn(first.error)) return first;
  return build(false);
}
