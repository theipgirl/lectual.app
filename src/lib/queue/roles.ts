import type { Role } from "@/lib/auth/roles";
import { ROLES } from "@/lib/auth/roles";
import type { getScopedClient } from "@/lib/db/scoped-client";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * Who may APPROVE or REJECT a queued client communication.
 *
 * Approving releases a message to a client under the firm's name, so this is
 * the attorney's call — deliberately narrower than "is a member of the org".
 * Membership is not authorization: `viewer` and `social_media` are members
 * too, and until this gate existed either of them could authorize outgoing
 * client mail from the dashboard.
 *
 * Mirrors CLAIM_REVIEW_ROLES in src/lib/brain/claims.ts, which makes the same
 * judgement about who may approve firm-voice content.
 *
 * NOTE: this cannot be enforced by RLS. The approval queue lives outside this
 * Postgres database (it is the lawmatics-mcp service's table), so Postgres
 * never sees these calls — the app layer IS the boundary here, not a
 * convenience in front of one. Keep the check in the server action.
 */
export const QUEUE_APPROVE_ROLES: Role[] = ["owner", "admin", "senior_admin", "attorney"];

/**
 * Who may SAVE an edit to a draft without resolving it. Broader than approval
 * on purpose: paralegals, law clerks and intake staff routinely prepare and
 * correct drafts that an attorney then signs off. They still cannot approve.
 */
export const QUEUE_EDIT_ROLES: Role[] = [
  ...QUEUE_APPROVE_ROLES,
  "intake",
  "paralegal",
  "law_clerk",
  "clerk",
];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the caller's role in their active org via the `current_org_role()`
 * RPC — the same JWT-claim-backed helper RLS policies use — and checks it
 * against `allowed`. Re-resolved on every call; never cache a prior result
 * across actions, and never trust a role passed in from a form.
 *
 * Returns null when the caller is not permitted, so callers can render a
 * friendly form error rather than throwing.
 */
export async function resolveQueueRole(
  supabase: ScopedClient,
  allowed: Role[],
): Promise<Role | null> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (!isRole(data) || !allowed.includes(data)) return null;
  return data;
}

/** True if this role may approve/reject. Safe for UI gating — the server action re-checks. */
export function canApproveQueue(role: Role): boolean {
  return QUEUE_APPROVE_ROLES.includes(role);
}

/** True if this role may save a draft edit. Safe for UI gating — the server action re-checks. */
export function canEditQueueDraft(role: Role): boolean {
  return QUEUE_EDIT_ROLES.includes(role);
}
