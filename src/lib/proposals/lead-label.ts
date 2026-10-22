/**
 * How a lead is named in a proposals picker. Pure, so the New proposal picker's
 * tests need no database; `lead-options.ts` re-exports it for the transcript picker.
 */

export type LeadLabelRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null };

/** "Ana Ruiz · Ruiz Co", or whichever parts exist; the email as a last resort. */
export function leadOptionLabel(lead: LeadLabelRow): string {
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  const business = lead.business_name?.trim() ?? "";
  if (person && business) return `${person} · ${business}`;
  return person || business || lead.email?.trim() || "Unnamed lead";
}
