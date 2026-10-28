/**
 * A contact line for the client's proposal page, taken from the firm's own profile.
 *
 * The profile has no phone or email column and this app adds no migration, so the line is derived
 * from the email sign-off the firm already wrote: the first email address and the first
 * phone-looking number in it. Neither found = no line (the page omits it); nothing is invented and
 * no firm's address is built in.
 */
export type FirmContact = { email: string | null; phone: string | null };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;

export function firmContactFromSignoff(signoff: string | null | undefined): FirmContact | null {
  const text = signoff ?? "";
  const email = text.match(EMAIL)?.[0] ?? null;
  const phone = text.match(PHONE)?.[0]?.trim() ?? null;
  return email || phone ? { email, phone } : null;
}

/** "(305) 555-0100 · info@firm.com" — the order the footer reads in. */
export function contactLine(contact: FirmContact | null): string | null {
  if (!contact) return null;
  const parts = [contact.phone, contact.email].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : null;
}
