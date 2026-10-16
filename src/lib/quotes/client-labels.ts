/**
 * Pure labels for the "New quote" client picker (clients.ts reads the rows).
 *
 * A lead is named by the PERSON and the business both — "Jordan Rivera ·
 * Rivera Roasters LLC · jordan@…" — because a firm quotes a person, and two
 * leads from one business (or a business name nobody remembers) are otherwise
 * indistinguishable in a long list. Parts that are missing are left out, never
 * printed as blanks.
 */
export function leadPickerLabel(lead: {
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
}): string {
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  const business = lead.business_name?.trim() ?? "";
  const email = lead.email?.trim() ?? "";
  const parts = [person, business && business !== person ? business : "", email].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Unnamed lead";
}
