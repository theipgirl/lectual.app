/** A team of fewer than three starts with the invite form open; a bigger one keeps it folded away. An unreadable team stays folded. */
export const INVITE_OPEN_BELOW = 3;

export function inviteFormOpen(memberCount: number, loadFailed: boolean): boolean {
  return !loadFailed && memberCount < INVITE_OPEN_BELOW;
}
