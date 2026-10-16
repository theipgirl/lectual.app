import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, hasRole, type Role } from "./roles";

/**
 * The caller's role in their ACTIVE org, read through their own scoped client.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * This exact read — `rpc("current_org_role")`, then narrow the `unknown` it
 * returns against ROLES — was already copy-pasted into the Settings page and
 * the service-library page, and two more surfaces needed it the day Quotes and
 * the Copilot tabs got role gates. Four hand-rolled copies of an authorization
 * read is how one of them ends up subtly different from the others, and the
 * one that differs is the one nobody notices.
 *
 * ── IT FAILS CLOSED, AND THAT IS THE WHOLE CONTRACT ─────────────────────────
 * `current_org_role()` returns null when the JWT carries no `active_org_id` —
 * which is not a hypothetical: prod once had the custom access-token hook
 * switched off, and every RLS policy in the product evaluated against null
 * while the app looked merely empty. A role read that threw, or that guessed a
 * default, would have turned that outage into an authorization bypass.
 *
 * So: any failure — the rpc erroring, a null, a string that is not a known
 * role — resolves to `null`, and `null` satisfies no requirement. A caller
 * whose role we could not establish is treated as having none.
 *
 * Note this answers "what may this person do", never "which org are they in".
 * Org scoping is RLS's job and is not negotiable from here; this only ever
 * narrows what an already-scoped caller may reach inside their own firm.
 */
export async function currentRole(): Promise<Role | null> {
  try {
    const supabase = await getScopedClient();
    const { data } = await supabase.rpc("current_org_role");
    return typeof data === "string" && (ROLES as readonly string[]).includes(data)
      ? (data as Role)
      : null;
  } catch {
    return null;
  }
}

/**
 * True when the caller ranks at or above `required`.
 *
 * Prefer this over calling `currentRole()` and comparing by hand: it is the
 * unreadable-role-is-not-authorized rule in one place, so a surface cannot
 * accidentally treat `null` as permissive by writing `role !== "viewer"` or
 * some other denylist.
 *
 * Both a PAGE and every server ACTION behind it must call this. A `"use server"`
 * function is its own POST entry point that never renders a layout, so a page
 * check protects the page and nothing else (AGENTS.md).
 */
export async function callerHasRole(required: Role): Promise<boolean> {
  const role = await currentRole();
  return role !== null && hasRole(role, required);
}
