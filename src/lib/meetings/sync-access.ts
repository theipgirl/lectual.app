import { hasRole, type Role } from "@/lib/auth/roles";
import type { MeetingConnection } from "@/lib/meetings/connection";

/**
 * Who may run a meeting import: the admin tier. `importNowAction`, the "Sync new meetings" action and the
 * pages that decide whether to draw the button all ask this one function, so there is no second role list.
 */
export function canSyncMeetings(role: Role | string | null | undefined): boolean {
  return !!role && hasRole(role as Role, "senior_admin");
}

export type SyncControl = "none" | "connect" | "sync";

/**
 * What to draw next to the meeting list: nothing for a role that cannot run an import, a link to connect a source when the
 * firm has none (or its connections could not be read, which must not read as "connected"), else the sync button.
 */
export function syncControl(role: Role | string | null | undefined, connections: readonly Pick<MeetingConnection, "provider" | "status">[] | null): SyncControl {
  if (!canSyncMeetings(role)) return "none";
  if (!connections || connections.length === 0) return "connect";
  return "sync";
}
