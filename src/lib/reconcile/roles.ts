import type { Role } from "@/lib/auth/roles";

/** Who may open the screen, preview and apply: the admin tier. Gated on the page and in every action. */
export const RECONCILE_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export function canReconcile(role: string | null | undefined): boolean {
  return !!role && (RECONCILE_ROLES as readonly string[]).includes(role);
}
