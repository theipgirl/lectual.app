import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { ROLES, hasRole, type Role } from "@/lib/auth/roles";

export type Stage = Database["public"]["Tables"]["crm_stage"]["Row"];
export type Tag = Database["public"]["Tables"]["crm_tag"]["Row"];
export type OrgMember = Database["public"]["Tables"]["crm_org_member"]["Row"];
export type OrgTheme = Database["public"]["Tables"]["crm_org_theme"]["Row"];

export type StageCategory = Database["public"]["Enums"]["crm_stage_category"];
export type TagDimension = Database["public"]["Enums"]["crm_tag_dimension"];

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Roles allowed to manage firm settings (pipeline stages, tag catalog, team
 * membership, firm theme). Mirrors the *_insert_admin / *_update_admin /
 * *_delete_admin RLS policies on crm_stage and crm_tag
 * (supabase/migrations/0016_pipeline.sql) and the member_*_admin policies on
 * crm_org_member (0002_rls.sql): owner, admin, senior_admin only. Fast,
 * friendly app-layer check — RLS is the real boundary and must never diverge
 * from this list without updating both (defense-in-depth, never the reverse).
 */
export const SETTINGS_ADMIN_ROLES: Role[] = ["owner", "admin", "senior_admin"];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the caller's role via the `current_org_role()` RPC (the same
 * JWT-claim-backed helper RLS policies use; see supabase/migrations/
 * 0002_rls.sql) and requires it be in SETTINGS_ADMIN_ROLES. Returns the
 * caller's role so callers (e.g. setMemberRole) can reason about privilege.
 * Re-checked on every call — never cache a prior result across actions.
 */
export async function requireSettingsAdminRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !SETTINGS_ADMIN_ROLES.includes(data)) {
    throw new Error("You don't have permission to change firm settings.");
  }
  return data;
}

/** Resolves the caller's active org id via the `current_org_id()` RPC. */
export async function currentOrgId(supabase: ScopedClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw error;
  if (!data) throw new Error("No active organization for the current session.");
  return data;
}

// ── Pipeline stages ─────────────────────────────────────────────────────────

/**
 * Lists the active org's pipeline stages, ordered for board rendering. RLS
 * (crm_stage_select_own) scopes rows to the caller's org — no org_id filter
 * is applied here on purpose (see AGENTS.md tenant-isolation rule). Not
 * role-gated: any signed-in org member may read the stage catalog.
 */
export async function listStages(): Promise<Stage[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_stage")
    .select("*")
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type CreateStageInput = {
  name: string;
  category: StageCategory;
  orderIndex?: number;
  agingThresholdDays?: number | null;
};

/**
 * Creates a pipeline stage. Admin-gated (owner/admin/senior_admin). org_id is
 * always the caller's active org (never taken from the input). When
 * orderIndex is omitted it appends after the current last stage.
 */
export async function createStage(input: CreateStageInput): Promise<Stage> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  let orderIndex = input.orderIndex;
  if (orderIndex === undefined) {
    const { data: last, error: lastError } = await supabase
      .from("crm_stage")
      .select("order_index")
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;
    orderIndex = (last?.order_index ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("crm_stage")
    .insert({
      org_id: orgId,
      name: input.name,
      category: input.category,
      order_index: orderIndex,
      aging_threshold_days: input.agingThresholdDays ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Renames a stage. Admin-gated. */
export async function renameStage(id: string, name: string): Promise<Stage> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_stage")
    .update({ name })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Moves a stage to a new order position. Admin-gated. */
export async function reorderStage(id: string, orderIndex: number): Promise<Stage> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_stage")
    .update({ order_index: orderIndex })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Sets (or clears, with null) a stage's aging threshold in days. Admin-gated. */
export async function setStageAging(
  id: string,
  agingThresholdDays: number | null,
): Promise<Stage> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_stage")
    .update({ aging_threshold_days: agingThresholdDays })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Deletes a stage. Admin-gated. */
export async function deleteStage(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const { error } = await supabase.from("crm_stage").delete().eq("id", id);
  if (error) throw error;
}

// ── Tag catalog ───────────────────────────────────────────────────────────

/** Lists the active org's tag catalog. RLS scopes rows to the caller's org. Not role-gated. */
export async function listTags(): Promise<Tag[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_tag")
    .select("*")
    .order("dimension", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type CreateTagInput = {
  code: string;
  label: string;
  dimension: TagDimension;
  color?: string | null;
  description?: string | null;
};

/**
 * Creates a tag. Admin-gated. org_id is always the caller's active org (never
 * taken from the input).
 */
export async function createTag(input: CreateTagInput): Promise<Tag> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const { data, error } = await supabase
    .from("crm_tag")
    .insert({
      org_id: orgId,
      code: input.code,
      label: input.label,
      dimension: input.dimension,
      color: input.color ?? null,
      description: input.description ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type UpdateTagInput = {
  code?: string;
  label?: string;
  dimension?: TagDimension;
  color?: string | null;
  description?: string | null;
};

/** Updates a tag's editable fields. Admin-gated. org_id is never patched. */
export async function updateTag(id: string, patch: UpdateTagInput): Promise<Tag> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);

  const update: Database["public"]["Tables"]["crm_tag"]["Update"] = {};
  if (patch.code !== undefined) update.code = patch.code;
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.dimension !== undefined) update.dimension = patch.dimension;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.description !== undefined) update.description = patch.description;

  const { data, error } = await supabase
    .from("crm_tag")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Deletes a tag. Admin-gated. */
export async function deleteTag(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const { error } = await supabase.from("crm_tag").delete().eq("id", id);
  if (error) throw error;
}

// ── Team members ────────────────────────────────────────────────────────────

/**
 * Lists the active org's members. RLS (member_select_own_org) scopes rows to
 * the caller's org. Not role-gated for reading — any member can see the
 * roster; only admins can change roles (setMemberRole).
 */
export async function listMembers(): Promise<OrgMember[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_org_member")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Changes a member's role. Admin-gated (owner/admin/senior_admin) — mirrors
 * crm_org_member's member_update_admin RLS policy, the defense against
 * self-escalation (a viewer must never be able to promote itself to owner).
 *
 * Beyond the admin gate, four guards run before the write, in order:
 *  a) Self-change — a caller can never change their own role (closes the
 *     self-management edge case, even for an owner).
 *  b) Target-rank ceiling — a caller may only modify members at or below
 *     their own rank: hasRole(callerRole, targetCurrentRole) must hold. This
 *     is what stops an admin from demoting (or otherwise touching) the owner.
 *  c) Last-owner guard — if the target is currently the org's only owner,
 *     the org can never be left ownerless: changing away from "owner" is
 *     refused when the owner headcount is <= 1.
 *  d) Granted-role ceiling (pre-existing) — a caller can never grant a role
 *     MORE privileged than their own: hasRole(callerRole, role) must hold,
 *     so an admin cannot mint an owner and a senior_admin cannot mint an
 *     admin.
 * RLS enforces the org scope throughout; these are the app-layer privilege
 * checks (defense-in-depth, never a substitute for RLS).
 */
export async function setMemberRole(userId: string, role: Role): Promise<OrgMember> {
  if (!isRole(role)) {
    throw new Error(`Invalid role: ${String(role)}`);
  }

  const supabase = await getScopedClient();
  const callerRole = await requireSettingsAdminRole(supabase);

  // a) Self-change guard.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (user?.id === userId) {
    throw new Error("You can't change your own role.");
  }

  // b) Target-rank ceiling — fetch the target's current role; RLS already
  // scopes this to the active org.
  const { data: target, error: targetError } = await supabase
    .from("crm_org_member")
    .select("role")
    .eq("user_id", userId)
    .single();
  if (targetError) throw targetError;
  const targetCurrentRole = (target as { role?: Role } | null)?.role;
  if (!targetCurrentRole || !hasRole(callerRole, targetCurrentRole)) {
    throw new Error(
      `You can only modify members at or below your own rank (${callerRole} cannot modify ${
        targetCurrentRole ?? "that member"
      }).`,
    );
  }

  // c) Last-owner guard — never let the org drop to zero owners.
  if (targetCurrentRole === "owner" && role !== "owner") {
    const { count, error: countError } = await supabase
      .from("crm_org_member")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner");
    if (countError) throw countError;
    if ((count ?? 0) <= 1) {
      throw new Error("An org must keep at least one owner.");
    }
  }

  // d) Granted-role ceiling (pre-existing).
  if (!hasRole(callerRole, role)) {
    throw new Error(
      `You can't grant a role above your own (${callerRole} cannot grant ${role}).`,
    );
  }

  const { data, error } = await supabase
    .from("crm_org_member")
    .update({ role })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ── Firm theme ────────────────────────────────────────────────────────────

/**
 * Reads the active org's theme row, or null when none has been saved yet
 * (the firm layout falls back to DEFAULT_THEME in that case). RLS scopes the
 * single row to the caller's org.
 */
export async function getTheme(): Promise<OrgTheme | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_org_theme").select("*").maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type UpdateThemeInput = {
  primary_color?: string;
  accent_color?: string;
  ink_color?: string;
  surface_color?: string;
  font_display?: string;
  font_body?: string;
  logo_url?: string | null;
};

/**
 * Saves theme edits. Admin-gated at the app layer (the crm_org_theme RLS
 * policy is org-scoped but not role-gated, so this is the privilege gate).
 * Upserts on org_id — there may be no row yet, since one isn't seeded at
 * provision time. org_id is always the caller's active org.
 */
export async function updateTheme(patch: UpdateThemeInput): Promise<OrgTheme> {
  const supabase = await getScopedClient();
  await requireSettingsAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const row: Database["public"]["Tables"]["crm_org_theme"]["Insert"] = {
    org_id: orgId,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("crm_org_theme")
    .upsert(row, { onConflict: "org_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
