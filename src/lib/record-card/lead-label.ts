/**
 * How a lead is labelled on Intake, Matters pickers and the opened card (Taylor, Nov 17 call): the PERSON's name first, with
 * the business and the mark beside it as the sub-line. The company stands in as the name only when there is no person's name,
 * and the email only when there is neither. PURE.
 */
export type LeadLabelInput = {
  first_name?: string | null;
  last_name?: string | null;
  business_name?: string | null;
  mark_text?: string | null;
  email?: string | null;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();

export function leadLabel(lead: LeadLabelInput, fallback = ""): { name: string; sub: string | null } {
  const person = [clean(lead.first_name), clean(lead.last_name)].filter(Boolean).join(" ");
  const business = clean(lead.business_name);
  const mark = clean(lead.mark_text);
  const email = clean(lead.email);
  const name = person || business || email || fallback;
  // The business is the name when there is no person; never repeated beside itself.
  const parts = [person ? business : "", mark].filter((p, i, all) => !!p && p !== name && all.indexOf(p) === i);
  return { name, sub: parts.length ? parts.join(" · ") : null };
}
