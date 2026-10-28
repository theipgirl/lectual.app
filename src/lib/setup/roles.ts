import type { Role } from "@/lib/auth/roles";

/** Who sees the setup checklist and the Today card: the admin tier. Checked on the page, the redirect and the card. */
export const SETUP_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

/** How the admin tier is named in a sentence a person reads. */
export const ADMIN_TIER_PHRASE = "Senior admin or above";

/** Fails closed: `null`, `undefined` and any string that is not one of the three roles are refused. */
export function canSeeSetup(role: string | null | undefined): boolean {
  return !!role && (SETUP_ROLES as readonly string[]).includes(role);
}
