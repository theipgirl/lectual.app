import "server-only";

import { ROLES } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { canReconcile } from "./roles";
import { RECONCILE_MESSAGES as MSG } from "./rules";

type Scoped = Awaited<ReturnType<typeof getScopedClient>>;

function isKnownRole(value: unknown): boolean {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The gate every reconcile action opens first: a signed-in session, a role that resolves, and the admin
 * tier. Nothing is cached (a POST is its own entry point), and every refusal is a fixed sentence.
 */
export async function authorizeReconcile(): Promise<{ ok: true; supabase: Scoped } | { ok: false; error: string }> {
  let supabase: Scoped;
  try {
    supabase = await getScopedClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return { ok: false, error: MSG.signedOut };
  } catch {
    return { ok: false, error: MSG.signedOut };
  }
  try {
    const { data, error } = await supabase.rpc("current_org_role");
    if (error || !isKnownRole(data)) return { ok: false, error: MSG.roleUnknown };
    if (!canReconcile(data as string)) return { ok: false, error: MSG.notAllowed };
    return { ok: true, supabase };
  } catch {
    return { ok: false, error: MSG.roleUnknown };
  }
}
