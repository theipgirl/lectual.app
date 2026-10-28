const DAY_MS = 86_400_000;

/**
 * "Last heard from 3 days ago" for the lead page's status row. It reads the lead's last-touch
 * field (`last_activity_at`); nothing recorded, an unreadable date or one in the future is
 * "No contact yet", never a made-up age.
 */
export function lastHeardLabel(lastActivityAt: string | null | undefined, now: number): string {
  const at = lastActivityAt ? Date.parse(lastActivityAt) : NaN;
  if (!Number.isFinite(at) || at > now) return "No contact yet";
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return "Last heard from today";
  return `Last heard from ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The phone Call / Email row: a link only for a value the lead really has. */
export function contactLinks(lead: { phone: string | null; email: string | null }): { call: string | null; email: string | null } {
  const digits = (lead.phone ?? "").replace(/[^\d+]/g, "");
  const email = (lead.email ?? "").trim();
  return {
    call: digits.replace(/\D/g, "").length >= 7 ? `tel:${digits}` : null,
    email: email.includes("@") ? `mailto:${email}` : null,
  };
}
