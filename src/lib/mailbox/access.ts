import { hasRole, type Role } from "@/lib/auth/roles";
import type { MailboxScope } from "./providers";

/**
 * Who may connect or disconnect which kind of mailbox. Mirrors the 0057 RLS
 * policies exactly: anyone in the firm manages their OWN personal mailbox;
 * only owner / admin / senior_admin manage the firm's shared ones.
 *
 * The database enforces this regardless. It is checked here too so a paralegal
 * pressing "Add Microsoft 365" is refused BEFORE being sent through a consent
 * screen whose result the database would then throw away.
 */
export function canManageScope(role: Role, scope: MailboxScope): boolean {
  return scope === "personal" || hasRole(role, "senior_admin");
}

export function isScope(value: unknown): value is MailboxScope {
  return value === "personal" || value === "firm";
}
