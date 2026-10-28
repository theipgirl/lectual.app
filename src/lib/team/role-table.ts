import { ROLES, ROLE_LABEL, hasRole, type Role } from "@/lib/auth/roles";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { FILE_DELETE_ROLES } from "@/lib/files/roles";

/**
 * "What each role can do": one row per role, computed from the SAME role lists the screens and
 * actions check, so the table cannot say more than the code enforces. Only the one-line
 * descriptions are written by hand, and they claim nothing a column doesn't show.
 */

export type RoleAbility = { key: "edit" | "approve" | "files" | "team"; label: string; has: (role: Role) => boolean };

export const ROLE_ABILITIES: readonly RoleAbility[] = [
  { key: "edit", label: "Edit leads and matters", has: (r) => CAN_WRITE_LEAD.includes(r) && MATTER_WRITE_ROLES.includes(r) },
  { key: "approve", label: "Approve client mail", has: (r) => QUEUE_APPROVE_ROLES.includes(r) },
  { key: "files", label: "Delete files", has: (r) => FILE_DELETE_ROLES.includes(r) },
  { key: "team", label: "Manage the team and settings", has: (r) => hasRole(r, "senior_admin") },
];

export const ROLE_BLURB: Record<Role, string> = {
  owner: "Runs the firm account. Everything an admin can do.",
  admin: "Runs the firm's settings and team day to day.",
  senior_admin: "Manages the team and settings, and works on leads and matters.",
  attorney: "Works on leads and matters and approves client mail.",
  intake: "Handles new leads and their first contact.",
  paralegal: "Works on leads and matters. Doesn't approve client mail.",
  law_clerk: "Legal support: drafting and research help on leads and matters. Doesn't approve client mail.",
  social_media: "Marketing help. Can see the firm's work but doesn't change leads or matters.",
  clerk: "Front-office support: keeps leads and matters up to date. Doesn't approve client mail.",
  viewer: "Can look but not change anything.",
};

/** Said under the table, because two roles have the same access today and a reader will wonder. */
export const CLERK_NOTE =
  "Clerk and Law clerk have the same access today. The name is for your own records: pick Law clerk for legal support and Clerk for front-office help.";

export type RoleRow = { role: Role; label: string; blurb: string; abilities: Record<RoleAbility["key"], boolean> };

export function roleRows(): RoleRow[] {
  return ROLES.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    blurb: ROLE_BLURB[role],
    abilities: Object.fromEntries(ROLE_ABILITIES.map((a) => [a.key, a.has(role)])) as RoleRow["abilities"],
  }));
}

/** The question asked before a role changes. */
export function roleChangeQuestion(name: string, from: string, to: string): string {
  return `Change ${name}'s role from ${ROLE_LABEL[from] ?? from} to ${ROLE_LABEL[to] ?? to}?`;
}
