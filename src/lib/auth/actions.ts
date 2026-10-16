"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * Session actions for the firm shell.
 *
 * Both live in one "use server" module (rather than beside a page) because the
 * chrome that needs them — the rail's account block and the "No firm access
 * yet" card in (firm)/layout.tsx — spans routes.
 */

/**
 * Ends the session and returns to sign-in. `scope: "global"` on purpose: the
 * firm dashboard is a privileged surface and "sign out" on a shared or
 * borrowed machine has to mean everywhere, not just this tab.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await getScopedClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/sign-in/?next=/dashboard");
}

export type SwitchFirmState = { error?: string };

/**
 * Moves the caller into another firm's workspace.
 *
 * Three steps, in this order, and the order is load-bearing:
 *
 *  1. `audit_org_switch` FIRST, so the record is written while the caller's
 *     token still says who they were. It no-ops for ordinary members — a firm
 *     member moving around their own org is product use, not an access event.
 *  2. `set_active_org` is the AUTHORIZATION BOUNDARY, not the UI. It refuses
 *     an org the caller neither belongs to nor has platform-admin rights over,
 *     and refuses an org id that does not exist. We surface its error rather
 *     than redirecting, because a silent no-op here would look identical to a
 *     successful switch that landed nowhere.
 *  3. `refreshSession()` — WITHOUT THIS THE SWITCH DOES NOTHING VISIBLE.
 *     active_org_id is written into the JWT by the custom-access-token hook at
 *     token-issue time (0003/0029/0050); it is not read live. Step 2 only
 *     stores the preference the hook will read. Until the token is re-minted,
 *     every RLS policy still evaluates against the OLD org and the dashboard
 *     renders the firm they just tried to leave.
 */
export async function switchFirmAction(
  _prev: SwitchFirmState,
  formData: FormData,
): Promise<SwitchFirmState> {
  const orgId = String(formData.get("orgId") ?? "").trim();
  if (!orgId) return { error: "No firm selected." };

  const supabase = await getScopedClient();

  // Best-effort: an audit-write failure must not block a legitimate switch,
  // but it must not pass unnoticed either.
  const { error: auditError } = await supabase.rpc("audit_org_switch", {
    p_org_id: orgId,
  });
  if (auditError) {
    console.error("[switchFirmAction] audit_org_switch failed", auditError);
  }

  const { error } = await supabase.rpc("set_active_org", { p_org_id: orgId });
  if (error) {
    return { error: `Couldn't switch firms: ${error.message}` };
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      error:
        "Switched, but your session couldn't be refreshed — sign out and back in to finish.",
    };
  }

  redirect("/dashboard");
}

export type RefreshAccessState = { ok?: boolean; error?: string };

/**
 * Re-mints the caller's JWT.
 *
 * A member who was just invited (or just had their role changed, or was added
 * to a second firm) is holding a token that predates the change: the
 * custom-access-token hook only writes active_org_id / org_role / org_ids when
 * the token is issued (0003/0029). Until the token is refreshed the app
 * genuinely cannot see their new membership, and the only recovery a user can
 * find on their own is clearing cookies. This button is that recovery.
 */
// Takes no arguments on purpose: there is nothing to read off the form, and
// useActionState happily calls a narrower function than its (prev, formData)
// signature.
export async function refreshAccessAction(): Promise<RefreshAccessState> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.auth.refreshSession();

  if (error) {
    return { error: `Couldn't refresh your access: ${error.message}` };
  }
  if (!data.session) {
    return { error: "Your session has expired — sign in again to pick up new access." };
  }

  // Re-render the server tree with the new claims (the rotated cookies were
  // written by the scoped client during refreshSession).
  refresh();
  return { ok: true };
}
