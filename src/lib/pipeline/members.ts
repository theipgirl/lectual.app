import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * A teammate who can be assigned a lead. `user_id` is an auth.users UUID and
 * `role` is their crm role in the active org.
 *
 * TODO(member-identity): there is no name/email on this shape yet, so every
 * assignee picker in the product still shows a truncated UUID. A member-
 * identity lookup RPC is being built separately — when it lands, resolve
 * display names through THAT and widen this type; do not add a competing
 * identity query here.
 */
export type OrgMember = { user_id: string; role: string };

/**
 * Lists the active org's members. RLS on crm_org_member scopes rows to the
 * caller's org, so no org_id filter is applied here (see AGENTS.md
 * tenant-isolation rule).
 */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("crm_org_member").select("user_id, role");
  if (error) throw error;
  return (data ?? []) as OrgMember[];
}
