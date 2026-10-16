import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { Condition, AutomationAction } from "./engine";

export type AutomationRule = Database["public"]["Tables"]["crm_automation_rule"]["Row"];
type AutomationTrigger = Database["public"]["Enums"]["crm_automation_trigger"];
type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Roles allowed to manage automation *config* (rules, drip sequences/steps,
 * email templates) — mirrors the *_insert_admin / *_update_admin /
 * *_delete_admin RLS policies on crm_automation_rule, crm_drip_sequence,
 * crm_drip_step, and crm_email_template (supabase/migrations/
 * 0022_automation.sql): owner, admin, senior_admin only. Fast, friendly
 * app-layer check — RLS is the real boundary and must never diverge from
 * this list without updating both (defense-in-depth, never the reverse).
 */
export const AUTOMATION_ADMIN_ROLES: Role[] = ["owner", "admin", "senior_admin"];

/**
 * Roles allowed to perform *operational* automation writes (drip enrollment)
 * — mirrors crm_drip_enrollment's *_staff RLS policies: every staff role
 * except social_media and viewer (the same set as MATTER_WRITE_ROLES /
 * LEAD_WRITE_ROLES elsewhere in the dashboard).
 */
export const AUTOMATION_STAFF_ROLES: Role[] = [
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
 * Resolves the caller's role via the `current_org_role()` RPC (the same
 * JWT-claim-backed helper RLS policies use; see supabase/migrations/
 * 0002_rls.sql) and requires it be in AUTOMATION_ADMIN_ROLES. Re-checked on
 * every call — never cache a prior result across actions. Shared by
 * rules.ts and drips.ts (config-write gate).
 */
export async function requireAutomationAdminRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !AUTOMATION_ADMIN_ROLES.includes(data)) {
    throw new Error("You don't have permission to manage automation.");
  }
  return data;
}

/**
 * Same shape as requireAutomationAdminRole but gated to the broader staff
 * set — used by operational writes like drip enrollment. Shared by
 * rules.ts and drips.ts.
 */
export async function requireAutomationStaffRole(supabase: ScopedClient): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !AUTOMATION_STAFF_ROLES.includes(data)) {
    throw new Error("You don't have permission to do this.");
  }
  return data;
}

/** Resolves the caller's active org id via the `current_org_id()` RPC. Shared by rules.ts and drips.ts. */
export async function currentOrgId(supabase: ScopedClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw error;
  if (!data) throw new Error("No active organization for the current session.");
  return data;
}

/**
 * Lists the active org's automation rules. RLS (crm_automation_rule_select_own)
 * scopes rows to the caller's org — no additional app-layer filter is applied
 * on purpose (see AGENTS.md tenant-isolation rule). Not role-gated: any
 * signed-in org member may read the rule catalog.
 */
export async function listRules(): Promise<AutomationRule[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_automation_rule")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Fetches a single rule by id, or null if not found / not visible under RLS. */
export async function getRule(id: string): Promise<AutomationRule | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_automation_rule")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type CreateRuleInput = {
  name: string;
  triggerType: AutomationTrigger;
  triggerConfig?: Record<string, unknown>;
  conditions?: Condition[];
  actions?: AutomationAction[];
  dryRun?: boolean;
  description?: string;
};

/**
 * Creates an automation rule. Admin-gated (owner/admin/senior_admin).
 * org_id is always the caller's active org (never taken from the input).
 */
export async function createRule(input: CreateRuleInput): Promise<AutomationRule> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const orgId = await currentOrgId(supabase);

  const { data, error } = await supabase
    .from("crm_automation_rule")
    .insert({
      org_id: orgId,
      name: input.name,
      description: input.description ?? "",
      trigger_type: input.triggerType,
      trigger_config: (input.triggerConfig ?? {}) as Database["public"]["Tables"]["crm_automation_rule"]["Insert"]["trigger_config"],
      conditions: (input.conditions ?? []) as unknown as Database["public"]["Tables"]["crm_automation_rule"]["Insert"]["conditions"],
      actions: (input.actions ?? []) as unknown as Database["public"]["Tables"]["crm_automation_rule"]["Insert"]["actions"],
      dry_run: input.dryRun ?? false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Flips a rule's active flag. Admin-gated. */
export async function toggleRule(id: string, active: boolean): Promise<AutomationRule> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_automation_rule")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Flips a rule's dry_run flag. Admin-gated. */
export async function setDryRun(id: string, dryRun: boolean): Promise<AutomationRule> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { data, error } = await supabase
    .from("crm_automation_rule")
    .update({ dry_run: dryRun, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Deletes a rule. Admin-gated. */
export async function deleteRule(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireAutomationAdminRole(supabase);
  const { error } = await supabase.from("crm_automation_rule").delete().eq("id", id);
  if (error) throw error;
}
