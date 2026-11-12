import type { Role } from "@/lib/auth/roles";

/**
 * Who may read a client's signature record (`client_proposal_signature`, lectual 0106): the staff roles, and nobody else.
 * The database's SELECT policy names exactly these eight; a viewer or social media reads NOTHING there. This is the one place
 * the app holds the list, and three things use it:
 *   - the staff proposal page decides whether to ATTEMPT the signature read (a role outside the list is never asked a question
 *     whose honest answer the database would hide);
 *   - the "Engagement letter" card draws the signer, time, fingerprint and Download only for these roles;
 *   - the signed-letter download action refuses everyone else.
 * RLS is the real boundary; this list is the app's matching, friendly refusal. A change here is a change to 0106's policy too.
 */
export const SIGNATURE_READ_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"];

/** Fails closed: no role, or one outside the list, reads no signature. */
export function canReadSignature(role: Role | null | undefined): boolean {
  return !!role && SIGNATURE_READ_ROLES.includes(role);
}
