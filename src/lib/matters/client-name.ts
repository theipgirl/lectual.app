import "server-only";
import { getLead } from "@/lib/pipeline/leads";
import type { Lead } from "@/lib/pipeline/leads";
import { primaryClientContact } from "./contacts";
import type { Contact } from "./contacts";
import type { MatterRow } from "./matters";

/**
 * Client-name resolution — the single source of truth for a question every
 * matter surface needs answered: "who do we call this matter's client?" This
 * chain (contact -> lead -> owner_name) was independently duplicated in four
 * places (MatterHero, MatterClientCard, MatterFactStrip,
 * src/lib/documents/generate.ts's two draft generators) before this file
 * existed. See NOTES-contacts-gap.md and 0048_crm_contact.sql for why
 * crm_contact exists at all.
 */

/** `business_name || "first last"`, trimmed, or null if a lead has neither. */
export function leadDisplayName(
  lead: Pick<Lead, "business_name" | "first_name" | "last_name"> | null | undefined,
): string | null {
  if (!lead) return null;
  const fullName = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  const name = lead.business_name?.trim() || fullName;
  return name || null;
}

/** Same shape as leadDisplayName, for a crm_contact row. */
export function contactDisplayName(
  contact: Pick<Contact, "business_name" | "first_name" | "last_name"> | null | undefined,
): string | null {
  if (!contact) return null;
  const fullName = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
  const name = contact.business_name?.trim() || fullName;
  return name || null;
}

/**
 * Pure precedence: an already-resolved contact name beats an already-resolved
 * lead name beats the tracker's owner_name, in that order. Each input is a
 * plain display string the caller has already formatted (via
 * leadDisplayName/contactDisplayName or its own equivalent) — this function
 * only picks among sources, it does not format one. Empty/whitespace-only
 * strings are treated as absent. Returns null when nothing resolves.
 */
export function resolveClientName(input: {
  contactName?: string | null;
  leadName?: string | null;
  ownerName?: string | null;
}): string | null {
  return (
    input.contactName?.trim() ||
    input.leadName?.trim() ||
    input.ownerName?.trim() ||
    null
  );
}

export type ClientNameSource = "contact" | "lead" | "owner_name" | "none";

/**
 * Server-only: resolves a matter's client name end to end. Loads the
 * matter's primary crm_matter_contact (role='client') -> crm_contact first;
 * falls back to the linked crm_lead; falls back to matter.owner_name.
 * `source` tells the caller which one actually won, so the UI can label an
 * unlinked tracker name ("Owner (tracker)") differently from a real link.
 */
export async function resolveMatterClientName(
  matter: Pick<MatterRow, "id" | "lead_id" | "owner_name">,
): Promise<{ name: string | null; source: ClientNameSource }> {
  const contact = await primaryClientContact(matter.id);
  const contactName = contactDisplayName(contact);
  if (contactName) return { name: contactName, source: "contact" };

  const lead = matter.lead_id ? await getLead(matter.lead_id) : null;
  const leadName = leadDisplayName(lead);
  if (leadName) return { name: leadName, source: "lead" };

  const ownerName = matter.owner_name?.trim() || null;
  if (ownerName) return { name: ownerName, source: "owner_name" };

  return { name: null, source: "none" };
}
