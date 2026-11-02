/**
 * Who sees the matter page's Billing card: the firm's owner, exactly. Not the admin tier, not
 * `hasRole` (which ranks roles). An unknown, empty or unreadable role is "no" (fails closed).
 * Pure; the page asks it with the role it resolved on this request, and the card's own server
 * component asks again.
 */
export function canSeeBilling(role: unknown): boolean {
  return role === "owner";
}
