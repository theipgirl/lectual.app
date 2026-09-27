import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database, Json } from "@/lib/db/types";
import { ROLES, type Role } from "@/lib/auth/roles";

export type BrainEntry = Database["public"]["Tables"]["crm_firm_brain_entry"]["Row"];
export type BrainCategory = Database["public"]["Enums"]["crm_brain_category"];

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Roles allowed to manage firm-brain entries (create/update/delete). Mirrors
 * the crm_brain_insert_admin / crm_brain_update_admin / crm_brain_delete_admin
 * RLS policies on crm_firm_brain_entry (lectual's supabase/migrations/
 * 0024_firm_brain.sql): owner, admin, senior_admin only. Fast, friendly
 * app-layer check — RLS is the real boundary and must never diverge from
 * this list without updating both (defense-in-depth, never the reverse).
 */
export const BRAIN_ADMIN_ROLES: Role[] = ["owner", "admin", "senior_admin"];

/**
 * Resolves the caller's role via the `current_org_role()` RPC (the same
 * JWT-claim-backed helper RLS policies use) and requires it be in
 * BRAIN_ADMIN_ROLES. Returns the caller's role. Re-checked on every call —
 * never cache a prior result across actions.
 */
export async function requireBrainAdminRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !BRAIN_ADMIN_ROLES.includes(data)) {
    throw new Error("You don't have permission to change the firm brain.");
  }
  return data;
}

/** Resolves the caller's active org id via the `current_org_id()` RPC. */
async function currentOrgId(supabase: ScopedClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw error;
  if (!data) throw new Error("No active organization for the current session.");
  return data;
}

/**
 * Lists the active org's firm-brain entries, optionally filtered by category,
 * ordered for catalog rendering. RLS (crm_brain_select_own) scopes rows to the
 * caller's org — no org_id filter is applied here on purpose (see AGENTS.md
 * tenant-isolation rule). Not role-gated: any signed-in org member may read.
 */
export async function listBrainEntries(category?: BrainCategory): Promise<BrainEntry[]> {
  const supabase = await getScopedClient();
  let query = supabase
    .from("crm_firm_brain_entry")
    .select("*")
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  if (category !== undefined) {
    query = query.eq("category", category);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Reads a single firm-brain entry by id, or null if not found/visible. RLS-scoped. */
export async function getBrainEntry(id: string): Promise<BrainEntry | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_firm_brain_entry")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type CreateBrainEntryInput = {
  category: BrainCategory;
  key: string;
  title: string;
  body?: string;
  data?: Json | null;
};

/**
 * Creates a firm-brain entry. Admin-gated (owner/admin/senior_admin). org_id
 * is always the caller's active org (never taken from the input); created_by
 * is always the caller's auth user id (never taken from the input).
 */
export async function createBrainEntry(input: CreateBrainEntryInput): Promise<BrainEntry> {
  const supabase = await getScopedClient();
  await requireBrainAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { data, error } = await supabase
    .from("crm_firm_brain_entry")
    .insert({
      org_id: orgId,
      category: input.category,
      key: input.key,
      title: input.title,
      body: input.body ?? "",
      data: input.data ?? null,
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type UpdateBrainEntryInput = {
  title?: string;
  body?: string;
  data?: Json | null;
  category?: BrainCategory;
  key?: string;
};

/** Updates a firm-brain entry's editable fields. Admin-gated. org_id is never patched. */
export async function updateBrainEntry(
  id: string,
  patch: UpdateBrainEntryInput,
): Promise<BrainEntry> {
  const supabase = await getScopedClient();
  await requireBrainAdminRole(supabase);

  const update: Database["public"]["Tables"]["crm_firm_brain_entry"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.body !== undefined) update.body = patch.body;
  if (patch.data !== undefined) update.data = patch.data;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.key !== undefined) update.key = patch.key;

  const { data, error } = await supabase
    .from("crm_firm_brain_entry")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Deletes a firm-brain entry. Admin-gated. */
export async function deleteBrainEntry(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireBrainAdminRole(supabase);
  const { error } = await supabase.from("crm_firm_brain_entry").delete().eq("id", id);
  if (error) throw error;
}
