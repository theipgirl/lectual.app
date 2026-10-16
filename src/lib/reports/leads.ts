/**
 * "Waiting on us" for a lead — shared by the Communication and Intake report
 * views. `crm_lead` has no `waiting_on` column (that concept exists only for
 * matters, via `crm_matter_stage.waiting_on`); the equivalent signal a lead
 * actually carries is which side spoke last: `last_inbound_at` vs
 * `last_outbound_at` (0055).
 *
 * A lead we have never replied to (`last_outbound_at` null) counts as waiting
 * on us the moment it has any inbound contact at all.
 *
 * Pure module: no server imports, so it is safe to unit-test directly.
 */

export type LeadWaitFields = {
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

export function isWaitingOnUs(lead: LeadWaitFields): boolean {
  if (!lead.last_inbound_at) return false;
  const inbound = Date.parse(lead.last_inbound_at);
  if (Number.isNaN(inbound)) return false;
  if (!lead.last_outbound_at) return true;
  const outbound = Date.parse(lead.last_outbound_at);
  return Number.isNaN(outbound) || inbound > outbound;
}

/** The timestamp a "waiting on us" lead has been waiting since — its last inbound contact. */
export function waitingSince(lead: LeadWaitFields): string | null {
  return isWaitingOnUs(lead) ? lead.last_inbound_at : null;
}

export type LeadLabelFields = {
  business_name: string | null;
  first_name: string;
  last_name: string;
  email: string;
};

/** Best human name for a lead: business name, else full name, else email —
 * mirrors the ordering src/app/dashboard/matters/page.tsx's lead options use. */
export function leadLabel(lead: LeadLabelFields): string {
  const business = lead.business_name?.trim();
  if (business) return business;
  const full = `${lead.first_name} ${lead.last_name}`.trim();
  return full || lead.email;
}
