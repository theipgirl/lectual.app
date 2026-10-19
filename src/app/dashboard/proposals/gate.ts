import "server-only";
import { notFound } from "next/navigation";
import { currentRole } from "@/lib/auth/current-role";
import { orgHasModule } from "@/lib/org/modules";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { NOT_ALLOWED, type ActionState } from "./errors";

/**
 * The gates every proposals PAGE and every proposals ACTION calls first.
 *
 * A "use server" function is its own POST endpoint that never renders a layout,
 * so the page's check protects the page and nothing else (AGENTS.md). Each
 * action therefore calls one of these as its first statement.
 *
 * The module refusal is `notFound()`, not an explanation: telling a firm that
 * the module exists but is off for it would tell it what another firm has.
 * The role refusal is an in-firm sentence, because naming the roles that may
 * write discloses nothing a colleague could not ask.
 *
 * The role lists are the friendly refusal that mirrors 0089's RLS. RLS (and,
 * for approval, the trigger) is the real boundary.
 */

export async function requireProposalsModule(): Promise<void> {
  if (!(await orgHasModule("proposals"))) notFound();
}

/** Module on, and the caller may write proposals. Null means go ahead. */
export async function gateStaffAction(): Promise<ActionState | null> {
  await requireProposalsModule();
  const role = await currentRole();
  return role && PROPOSAL_STAFF_WRITE_ROLES.includes(role) ? null : NOT_ALLOWED;
}

/** Module on, and the caller is owner / admin / senior_admin. Null means go ahead. */
export async function gateAdminAction(): Promise<ActionState | null> {
  await requireProposalsModule();
  const role = await currentRole();
  return role && PROPOSAL_ADMIN_ROLES.includes(role)
    ? null
    : { error: "Only owners, admins and senior admins can change the proposal settings." };
}
