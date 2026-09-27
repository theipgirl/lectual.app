import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { ROLES, type Role } from "@/lib/auth/roles";

export type ClaimEntry = Database["public"]["Tables"]["crm_claim_library"]["Row"];
export type ClaimStatus = Database["public"]["Enums"]["crm_claim_status"];

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Roles allowed to PROPOSE a claim (insert at status='proposed'). Mirrors the
 * non-admin branch of crm_claim_insert_propose (lectual's supabase/migrations/
 * 0024_firm_brain.sql): every staff role except viewer — viewer cannot write.
 * Admin roles + attorney can also propose (they can insert at any status via
 * CLAIM_REVIEW_ROLES, but a plain "propose" call from them is still fine),
 * so this list is deliberately "all roles except viewer".
 */
export const CLAIM_PROPOSE_ROLES: Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "intake",
  "paralegal",
  "law_clerk",
  "attorney",
  "clerk",
  "social_media",
];

/**
 * Roles allowed to REVIEW a claim (move proposed -> approved/forbidden, or
 * otherwise update it). Mirrors crm_claim_update_review exactly: owner,
 * admin, senior_admin, attorney.
 */
export const CLAIM_REVIEW_ROLES: Role[] = ["owner", "admin", "senior_admin", "attorney"];

/**
 * Roles allowed to DELETE a claim. Mirrors crm_claim_delete_admin exactly:
 * owner, admin, senior_admin only (narrower than CLAIM_REVIEW_ROLES — the
 * attorney may review/approve but not delete from the library).
 */
export const CLAIM_DELETE_ROLES: Role[] = ["owner", "admin", "senior_admin"];

/**
 * Resolves the caller's role via the `current_org_role()` RPC and requires it
 * be in CLAIM_PROPOSE_ROLES. Re-checked on every call — never cache a prior
 * result across actions.
 */
export async function requireClaimProposeRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !CLAIM_PROPOSE_ROLES.includes(data)) {
    throw new Error("You don't have permission to propose a claim.");
  }
  return data;
}

/**
 * Resolves the caller's role via the `current_org_role()` RPC and requires it
 * be in CLAIM_REVIEW_ROLES. Re-checked on every call — never cache a prior
 * result across actions.
 */
export async function requireClaimReviewRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !CLAIM_REVIEW_ROLES.includes(data)) {
    throw new Error("You don't have permission to review a claim.");
  }
  return data;
}

/**
 * Resolves the caller's role via the `current_org_role()` RPC and requires it
 * be in CLAIM_DELETE_ROLES. Re-checked on every call — never cache a prior
 * result across actions.
 */
async function requireClaimDeleteRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !CLAIM_DELETE_ROLES.includes(data)) {
    throw new Error("You don't have permission to delete a claim.");
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
 * Lists the active org's claim library, optionally filtered by status,
 * ordered for review-queue rendering. RLS (crm_claim_select_own) scopes rows
 * to the caller's org — no org_id filter is applied here on purpose (see
 * AGENTS.md tenant-isolation rule). Not role-gated: any signed-in org member
 * may read.
 */
export async function listClaims(status?: ClaimStatus): Promise<ClaimEntry[]> {
  const supabase = await getScopedClient();
  let query = supabase
    .from("crm_claim_library")
    .select("*")
    .order("status", { ascending: true })
    .order("claim", { ascending: true });
  if (status !== undefined) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export type ProposeClaimInput = {
  claim: string;
  context?: string;
  source?: string;
};

/**
 * Proposes a new claim. Propose-gated (CLAIM_PROPOSE_ROLES — everyone except
 * viewer). ALWAYS inserts at status='proposed', regardless of anything a
 * caller might pass — proposal is not approval (UPL/ad-rules firewall, see
 * AGENTS.md). org_id is always the caller's active org; created_by is always
 * the caller's auth user id.
 */
export async function proposeClaim(input: ProposeClaimInput): Promise<ClaimEntry> {
  const supabase = await getScopedClient();
  await requireClaimProposeRole(supabase);
  const orgId = await currentOrgId(supabase);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { data, error } = await supabase
    .from("crm_claim_library")
    .insert({
      org_id: orgId,
      claim: input.claim,
      context: input.context ?? "",
      source: input.source ?? null,
      created_by: user?.id ?? null,
      status: "proposed",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Reviews a claim — sets it to 'approved' or 'forbidden'. Review-gated
 * (CLAIM_REVIEW_ROLES: owner/admin/senior_admin/attorney). reviewed_by is
 * ALWAYS sourced from the current session's auth.getUser(), never from a
 * parameter — this is audit integrity, not a UX nicety. reviewed_at and
 * updated_at are always stamped to now().
 */
export async function reviewClaim(
  id: string,
  status: Extract<ClaimStatus, "approved" | "forbidden">,
  notes?: string,
): Promise<ClaimEntry> {
  const supabase = await getScopedClient();
  await requireClaimReviewRole(supabase);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const update: Database["public"]["Tables"]["crm_claim_library"]["Update"] = {
    status,
    reviewed_by: user?.id ?? null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) update.notes = notes;

  const { data, error } = await supabase
    .from("crm_claim_library")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // Append an immutable audit row (crm_claim_review_log) so a later status
  // flip can't erase who set the claim to approved|forbidden and when — the
  // in-place update above is the current state; this is the history. org_id is
  // taken from the updated claim row (RLS-scoped), never from input. Fail-closed:
  // a review that can't be recorded in the audit log must not be reported as done.
  const { error: logError } = await supabase.from("crm_claim_review_log").insert({
    org_id: data.org_id,
    claim_id: data.id,
    status,
    notes: notes ?? "",
    reviewed_by: user?.id ?? null,
  });
  if (logError) throw logError;

  return data;
}

/** Deletes a claim. Admin-gated (owner/admin/senior_admin — see CLAIM_DELETE_ROLES). */
export async function deleteClaim(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireClaimDeleteRole(supabase);
  const { error } = await supabase.from("crm_claim_library").delete().eq("id", id);
  if (error) throw error;
}
