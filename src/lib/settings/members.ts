import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { getSiteOrigin } from "@/lib/site-origin";
import { ROLES, hasRole, type Role } from "@/lib/auth/roles";
import {
  callMemberRpc,
  isMissingFunctionError,
  MEMBER_RPC_MIGRATION_HINT,
} from "@/lib/members/rpc";
import { normalizeEmail, isEmailAddress } from "@/lib/members/email";
import { requireSettingsAdminRole, currentOrgId } from "./admin";

/**
 * Onboarding and off-boarding firm staff — the two things that previously
 * required hand-written SQL against crm_org_member.
 *
 * Both re-run the privilege ceiling setMemberRole uses (admin gate, no
 * self-management, only act on members at or below your own rank, never grant
 * above your own rank, never leave the org ownerless). RLS remains the real
 * boundary: the membership insert/delete go through the RLS-scoped client, and
 * org_id is always the caller's active org, never taken from input.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type InviteOutcome =
  /** Already in this firm — nothing was written, no email was sent. */
  | "already_member"
  /** Had a Lectual account already; added to this firm without a new invite email. */
  | "added_existing_user"
  /** New to Lectual; an invite email was sent and membership was created. */
  | "invited";

export type InviteMemberResult = {
  outcome: InviteOutcome;
  email: string;
  /** Current role in this firm — the existing one for `already_member`. */
  role: Role;
};

export type RemoveMemberResult = {
  userId: string;
  /**
   * Set when the membership row was deleted but the forced sign-out could not
   * be performed. Never swallowed: the caller must surface it, because it
   * means the removed person may keep working access until their token expires.
   */
  warning?: string;
};

/** Fetches the target's current role in the active org (RLS scopes the read). */
async function targetRole(supabase: ScopedClient, userId: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from("crm_org_member")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const role = (data as { role?: string } | null)?.role;
  return isRole(role) ? role : null;
}

/** Refuses when the target currently holds the org's only owner seat. */
async function assertNotLastOwner(supabase: ScopedClient, current: Role): Promise<void> {
  if (current !== "owner") return;
  const { count, error } = await supabase
    .from("crm_org_member")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");
  if (error) throw error;
  if ((count ?? 0) <= 1) {
    throw new Error("An org must keep at least one owner.");
  }
}

/**
 * Invites someone to the active org, or adds them if they already have a
 * Lectual account. Idempotent: re-inviting an existing member writes nothing,
 * sends no email, and does not touch their role — use "Update role" for that.
 *
 * Order matters. The existing-user lookup and the membership check both run
 * before any invite email is sent, so a re-invite can never spam a colleague
 * who is already on the team.
 */
export async function inviteMember(emailInput: string, role: Role): Promise<InviteMemberResult> {
  if (!isRole(role)) {
    throw new Error(`Invalid role: ${String(role)}`);
  }
  const email = normalizeEmail(String(emailInput ?? ""));
  if (!email) throw new Error("Enter an email address.");
  if (!isEmailAddress(email)) throw new Error(`"${emailInput}" doesn't look like an email address.`);

  const supabase = await getScopedClient();
  const callerRole = await requireSettingsAdminRole(supabase);

  // Granted-role ceiling — identical to setMemberRole's guard (d). An admin
  // must never be able to mint an owner via the invite door.
  if (!hasRole(callerRole, role)) {
    throw new Error(`You can't grant a role above your own (${callerRole} cannot grant ${role}).`);
  }

  const orgId = await currentOrgId(supabase);

  // 1) Does this address already have an auth user? Admin-gated, active-org
  // scoped lookup (0031). Null = nobody has signed up with it yet.
  const { data: existingId, error: lookupError } = await callMemberRpc<string | null>(
    supabase,
    "org_admin_lookup_user_id",
    { p_email: email },
  );
  if (lookupError) {
    throw new Error(
      isMissingFunctionError(lookupError)
        ? `Member invites aren't available yet. ${MEMBER_RPC_MIGRATION_HINT}`
        : lookupError.message,
    );
  }

  let userId = existingId ?? null;
  let sentInvite = false;

  // 2) Already on the team? Report it and change nothing. RLS scopes this
  // read to the active org, so a member of a *different* firm is not a match.
  if (userId) {
    const current = await targetRole(supabase, userId);
    if (current) {
      return { outcome: "already_member", email, role: current };
    }
  }

  // 3) No account yet — send the invite email with the service-role client.
  if (!userId) {
    const origin = await getSiteOrigin();
    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/sign-in/?next=${encodeURIComponent("/dashboard")}`,
    });
    if (error || !data?.user?.id) {
      throw new Error(`Couldn't send the invite: ${error?.message ?? "no user returned"}`);
    }
    userId = data.user.id;
    sentInvite = true;
  }

  // 4) Membership row for the ACTIVE org. Written through the RLS-scoped
  // client, so member_insert_admin re-checks org + role server-side.
  const { error: insertError } = await supabase
    .from("crm_org_member")
    .insert({ org_id: orgId, user_id: userId, role });
  if (insertError) {
    // unique (org_id, user_id) — someone added them between our check and
    // this insert. Idempotent by design: report, don't overwrite.
    if ((insertError as { code?: string }).code === "23505") {
      const current = (await targetRole(supabase, userId)) ?? role;
      return { outcome: "already_member", email, role: current };
    }
    throw insertError;
  }

  return { outcome: sentInvite ? "invited" : "added_existing_user", email, role };
}

/**
 * Removes a member from the active org and forces them out of every session.
 *
 * The forced sign-out is NOT optional and NOT cosmetic. Authorization in this
 * app reads the active_org_id / org_role claims minted into the user's JWT, not
 * live DB state — so deleting the crm_org_member row alone leaves a removed
 * person holding a token that still says "member of this firm" until it
 * expires (up to an hour). Revoking their sessions is what stops that token
 * from being renewed. `revoke_member_sessions` (0031) runs BEFORE the row is
 * deleted, because its own authorization check is "target is a member of the
 * caller's active org" — that ordering is what keeps it from becoming a
 * log-out-anyone primitive.
 *
 * If revocation fails (e.g. 0031 not applied), the removal still proceeds —
 * losing the membership row is the more important half — but the caller gets a
 * warning it must show. Silently dropping it would turn a known exposure into
 * an invisible one.
 */
export async function removeMember(userId: string): Promise<RemoveMemberResult> {
  if (!userId) throw new Error("Missing member.");

  const supabase = await getScopedClient();
  const callerRole = await requireSettingsAdminRole(supabase);

  // a) Self-removal guard — mirrors setMemberRole's self-change guard.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (user?.id === userId) {
    throw new Error("You can't remove yourself. Ask another firm admin to do it.");
  }

  // b) Target-rank ceiling — only act on members at or below your own rank.
  const current = await targetRole(supabase, userId);
  if (!current) {
    throw new Error("That person isn't a member of your firm.");
  }
  if (!hasRole(callerRole, current)) {
    throw new Error(
      `You can only remove members at or below your own rank (${callerRole} cannot remove ${current}).`,
    );
  }

  // c) Last-owner guard — an org must never be left ownerless.
  await assertNotLastOwner(supabase, current);

  // d) Kill their sessions while the membership row still exists.
  let warning: string | undefined;
  const { error: revokeError } = await callMemberRpc<number>(supabase, "revoke_member_sessions", {
    p_user_id: userId,
  });
  if (revokeError) {
    warning = isMissingFunctionError(revokeError)
      ? `Removed, but their existing session could not be ended — it may keep working until the token expires. ${MEMBER_RPC_MIGRATION_HINT}`
      : `Removed, but their existing session could not be ended (${revokeError.message}) — it may keep working until the token expires.`;
  }

  // e) Delete the membership. RLS (member_delete_admin) re-checks org + role.
  const { error: deleteError } = await supabase
    .from("crm_org_member")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  return { userId, ...(warning ? { warning } : {}) };
}
