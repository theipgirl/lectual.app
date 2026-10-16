import "server-only";
import type { User } from "@supabase/supabase-js";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Role } from "@/lib/auth/roles";

/** The firm whose data the caller is standing inside (the active_org_id claim). */
export type FirmSessionOrg = {
  id: string;
  name: string;
  slug: string;
  modules: string[] | null;
};

/** A firm a platform admin may enter. Name only — never row counts or data. */
export type SwitchableFirmRef = { id: string; name: string };

export type FirmSession =
  | { kind: "signed-out"; redirectTo: string }
  | { kind: "no-access"; user: User }
  | {
      kind: "ok";
      user: User;
      /** Null for Lectual staff standing inside a firm they don't belong to. */
      member: { role: string; org_id: string } | null;
      org: FirmSessionOrg;
      role: Role;
      isPlatformAdmin: boolean;
      actingAsStaff: boolean;
      switchableFirms: SwitchableFirmRef[];
      displayName: string;
    };

function displayNameOf(user: User): string {
  const meta = user.user_metadata as { full_name?: string; name?: string } | null | undefined;
  return meta?.full_name || meta?.name || user.email?.split("@")[0] || "Team member";
}

/**
 * Who is here, which firm they are standing in, and what they may be shown.
 *
 * Ported from lectual/src/lib/firm/session.ts with the per-firm theme read
 * removed — lectual.app has one visual system (design/README.md). Every
 * route group in this app opens the door through this one function.
 *
 * Nothing here decides access on its own: every read below goes through
 * getScopedClient(), so RLS on the active_org_id claim is what actually
 * scopes them — no org_id filter is applied on purpose (see AGENTS.md).
 *
 * `signInNext` is the path to come back to after signing in; it is the only
 * thing the two callers disagree about.
 */
export async function resolveFirmSession(
  { signInNext = "/dashboard" }: { signInNext?: string } = {},
): Promise<FirmSession> {
  const supabase = await getScopedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { kind: "signed-out", redirectTo: `/sign-in/?next=${signInNext}` };
  }

  const [{ data: member }, { data: org }, { data: isPlatformAdmin }] =
    await Promise.all([
      supabase
        .from("crm_org_member")
        .select("role, org_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("crm_org").select("id, name, slug, modules").maybeSingle(),
      // Asked of the database, not read off the JWT claim: a claim is a
      // decoded cookie, and this decides whether someone may stand inside a
      // law firm they do not belong to.
      supabase.rpc("is_platform_admin"),
    ]);

  // Lectual staff visiting a firm they hold no membership in. `member` is null
  // for them by construction (they have no crm_org_member row anywhere), while
  // `org` DOES resolve, because the access-token hook wrote their chosen
  // active_org_id from user_org_preference (0050). Without this branch they
  // would be shown "No firm access yet" for every firm they picked.
  const actingAsStaff = Boolean(isPlatformAdmin) && !member && Boolean(org);

  // Authenticated but not (yet) a member of any org visible under RLS — fail
  // closed with an explanation rather than a redirect loop back to sign-in
  // (they ARE signed in; they just have no firm workspace).
  if ((!member && !actingAsStaff) || !org) {
    return { kind: "no-access", user };
  }

  // Staff hold no membership row, so their role comes from the org_role claim
  // the hook wrote (0050 sets it to 'owner' so the firm's own role-gated RLS
  // write policies behave exactly as they would for the firm's principal).
  const { data: claimedRole } = member
    ? { data: null }
    : await supabase.rpc("current_org_role");
  const role = (member?.role ?? claimedRole ?? "viewer") as Role;

  // The switcher list. Only platform staff can be offered a NAMED list:
  // 0002_rls.sql scopes crm_org to the ACTIVE org, so an ordinary member
  // holding two memberships can read the uuid of their other firm (via the
  // org_ids claim) but not its name — and a switcher showing hex fragments to
  // a law firm is worse than no switcher. platform_admin_orgs() returns names
  // only and raises for everyone else, so it is never called for them.
  let switchableFirms: SwitchableFirmRef[] = [];
  if (isPlatformAdmin) {
    const { data: orgs } = await supabase.rpc("platform_admin_orgs");
    switchableFirms = (orgs ?? []).map((o) => ({ id: o.id, name: o.name }));
  }

  return {
    kind: "ok",
    user,
    member: member ?? null,
    org: org as FirmSessionOrg,
    role,
    isPlatformAdmin: Boolean(isPlatformAdmin),
    actingAsStaff,
    switchableFirms,
    displayName: displayNameOf(user),
  };
}
