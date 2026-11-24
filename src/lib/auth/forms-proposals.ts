import type { Role } from "./roles";

/**
 * Who is SHOWN the Forms and Proposals sections (Taylor, Nov 2026): the admin tier plus intake. The one rule for every
 * place that draws a way in: the rail rows (Forms, Proposals, the older Quotes row), so the phone More sheet, the tour and the
 * hub too; Today's "Needs you" submissions link; the Intake report's tiles; the Leads page's "Open your intake form".
 * Navigation only: the pages and actions keep their own role and feature gates. Pure; fails closed (null, undefined and any
 * string that isn't one of these roles is refused).
 */
export const FORMS_PROPOSALS_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "intake"];

export function canSeeFormsAndProposals(role: string | null | undefined): boolean {
  return !!role && (FORMS_PROPOSALS_ROLES as readonly string[]).includes(role);
}
