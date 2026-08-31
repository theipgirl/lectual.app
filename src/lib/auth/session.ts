import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Role } from "@/lib/auth/roles";

/**
 * Current-user + org resolution, fail-closed.
 *
 * The logic here is extracted from theipgirl/lectual's `src/app/(firm)/layout.tsx`,
 * where it was inlined into a layout that also owned nine webfonts, a theme
 * provider and a queue fetch. Pulling it out is what lets this app's pages,
 * route handlers and server actions all ask the same question and get the same
 * answer — and lets it be unit-tested.
 *
 * Fail-closed is the whole point. Three outcomes, never two:
 *
 *   { status: "signed-out" }   → no session at all; send them to /sign-in/
 *   { status: "no-access" }    → authenticated, but no membership row is
 *                                visible under RLS. Render an explanation.
 *   { status: "ok", ... }      → a real firm workspace
 *
 * There is deliberately no "empty dashboard" outcome. A dashboard rendering
 * zero deadlines for someone with no firm access is indistinguishable from
 * "nothing is due", which is exactly the failure mode this product exists to
 * prevent. Absence of access must look like absence of access.
 *
 * NOTE ON SCOPING: the reads below carry no `org_id` filter. That is
 * deliberate and load-bearing — getScopedClient() sends the user's JWT, whose
 * `active_org_id` claim (minted by the project-level
 * `public.custom_access_token_hook`) is what RLS scopes on. Adding a filter
 * here would mask a policy regression instead of surfacing it.
 */

export type Session = {
  status: "ok";
  user: { id: string; email: string | null };
  orgId: string;
  orgName: string;
  role: Role;
  /** Lectual staff standing in a firm they hold no membership row in. */
  actingAsStaff: boolean;
};

export type NoSession =
  | { status: "signed-out" }
  | { status: "no-access"; user: { id: string; email: string | null } };

export type SessionResult = Session | NoSession;

/**
 * Resolves the caller's session. Never throws for the unauthenticated or
 * unauthorized cases — callers branch on `status`, so neither case can be
 * accidentally swallowed by a try/catch and rendered as an empty page.
 */
export async function requireSession(): Promise<SessionResult> {
  const supabase = await getScopedClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "signed-out" };

  const identity = { id: user.id, email: user.email ?? null };

  const [{ data: member }, { data: org }, { data: isPlatformAdmin }] = await Promise.all([
    supabase.from("crm_org_member").select("role, org_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("crm_org").select("id, name").maybeSingle(),
    // Asked of the database, not read off the JWT claim: a claim is a decoded
    // cookie, and this decides whether someone may stand inside a law firm
    // they do not belong to.
    supabase.rpc("is_platform_admin"),
  ]);

  // Lectual staff visiting a firm they hold no membership in. `member` is null
  // for them by construction, while `org` DOES resolve, because the
  // access-token hook wrote their chosen active_org_id from
  // user_org_preference. Without this branch they would be shown "no firm
  // access" for every firm they picked.
  const actingAsStaff = Boolean(isPlatformAdmin) && !member && Boolean(org);

  if ((!member && !actingAsStaff) || !org) {
    return { status: "no-access", user: identity };
  }

  // Staff hold no membership row, so their role comes from the org_role claim
  // the access-token hook wrote ('owner', so the firm's own role-gated RLS
  // write policies behave as they would for the firm's principal).
  const { data: claimedRole } = member
    ? { data: null }
    : await supabase.rpc("current_org_role");

  const role = (member?.role ?? claimedRole ?? "viewer") as Role;

  return {
    status: "ok",
    user: identity,
    orgId: org.id,
    orgName: org.name,
    role,
    actingAsStaff,
  };
}

/** Narrowing helper so callers can write `if (isSignedIn(s))`. */
export function isSignedIn(result: SessionResult): result is Session {
  return result.status === "ok";
}
