import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { callMemberRpc, isMissingFunctionError } from "./rpc";

/**
 * The member roster, with identity attached.
 *
 * crm_org_member carries no email or name and auth.users is unreachable under
 * RLS, so the roster used to render bare UUIDs. `org_member_directory()`
 * (supabase/migrations/0031_member_identity.sql) joins the two behind a
 * SECURITY DEFINER function that is scoped to the caller's ACTIVE ORG — that
 * scoping, not RLS, is what keeps one firm from resolving another firm's users.
 */

export type MemberIdentity = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  /** false when identity couldn't be resolved and only the user id is known. */
  identified: boolean;
};

type DirectoryRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
};

function toRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "viewer";
}

/**
 * Lists the active org's members with email + display name.
 *
 * If 0031 hasn't been applied yet the roster degrades to ids rather than
 * breaking the settings page — the same rows RLS already allows, just without
 * identity. Any other RPC failure is a real error and is thrown.
 */
export async function listMemberDirectory(): Promise<MemberIdentity[]> {
  const supabase = await getScopedClient();

  const { data, error } = await callMemberRpc<DirectoryRow[]>(supabase, "org_member_directory");

  if (!error) {
    return (data ?? []).map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: toRole(row.role),
      identified: true,
    }));
  }

  if (!isMissingFunctionError(error)) {
    throw new Error(error.message);
  }

  console.warn(
    "[members] org_member_directory() is missing — falling back to ids. " +
      "Apply supabase/migrations/0031_member_identity.sql.",
  );

  // RLS (member_select_own_org) scopes these rows to the caller's active org —
  // no org_id filter here on purpose (see AGENTS.md tenant-isolation rule).
  const { data: rows, error: rowsError } = await supabase
    .from("crm_org_member")
    .select("user_id, role")
    .order("created_at", { ascending: true });
  if (rowsError) throw rowsError;

  return (rows ?? []).map((row) => ({
    userId: row.user_id,
    email: null,
    displayName: null,
    role: toRole(row.role),
    identified: false,
  }));
}
