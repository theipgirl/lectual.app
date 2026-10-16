import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";

/**
 * crm_contact / crm_matter_contact data access (0048_crm_contact.sql). See
 * that migration's header comment and NOTES-contacts-gap.md for the full
 * design — a real person/business record, distinct from crm_lead (pre-matter
 * prospect) and crm_matter.owner_name (free-text, no FK).
 */
export type Contact = Database["public"]["Tables"]["crm_contact"]["Row"];
export type MatterContactLink = Database["public"]["Tables"]["crm_matter_contact"]["Row"];

export type CreateContactInput = {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  notes?: string | null;
};

/**
 * Creates a contact in the caller's active org. Staff-role-gated (mirrors
 * createMatter / applyTag). org_id is always the caller's active org — never
 * taken from the input.
 */
export async function createContact(input: CreateContactInput): Promise<Contact> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId) throw new Error("No active organization for the current session.");

  const { data, error } = await supabase
    .from("crm_contact")
    .insert({
      org_id: orgId,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      business_name: input.businessName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company_name: input.companyName ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Links a contact to a matter (role defaults to 'client'). BOTH ids are
 * resolved through the CALLER'S OWN scoped client first — never trusted
 * verbatim off the input — so an id belonging to another org is simply
 * invisible (RLS already hides it) before any crm_matter_contact row is ever
 * written, and org_id on the join row is read off the MATTER, never the
 * caller. This is the exact discipline applyTag (src/lib/pipeline/tags.ts)
 * uses for crm_lead_tag, the one other join table with this
 * org_id-denormalized / no-composite-FK shape. See 0048's header comment.
 */
export async function linkMatterContact(
  matterId: string,
  contactId: string,
  role: string = "client",
): Promise<MatterContactLink> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("org_id")
    .eq("id", matterId)
    .single();
  if (matterError) throw matterError;

  // Confirms the contact is actually visible under RLS (i.e. belongs to the
  // caller's own org) before it can be paired with the matter.
  const { data: contact, error: contactError } = await supabase
    .from("crm_contact")
    .select("id")
    .eq("id", contactId)
    .single();
  if (contactError) throw contactError;

  const { data, error } = await supabase
    .from("crm_matter_contact")
    .insert({ org_id: matter.org_id, matter_id: matterId, contact_id: contact.id, role })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * All contacts linked to a matter, any role. Two plain queries (link ids,
 * then contacts by id) — same shape as tagsForLead (src/lib/pipeline/tags.ts)
 * — rather than a foreign-table embed.
 */
export async function listMatterContacts(matterId: string): Promise<Contact[]> {
  const supabase = await getScopedClient();

  const { data: links, error: linkError } = await supabase
    .from("crm_matter_contact")
    .select("contact_id")
    .eq("matter_id", matterId);
  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  const ids = [...new Set(links.map((l) => l.contact_id))];
  const { data: contacts, error } = await supabase.from("crm_contact").select("*").in("id", ids);
  if (error) throw error;
  return contacts ?? [];
}

/**
 * The matter's primary client-role contact, or null when there isn't one
 * (yet). "First" when more than one client-role row exists — a matter with a
 * co-client is a later UI concern, not this function's.
 */
export async function primaryClientContact(matterId: string): Promise<Contact | null> {
  const supabase = await getScopedClient();

  const { data: link, error: linkError } = await supabase
    .from("crm_matter_contact")
    .select("contact_id")
    .eq("matter_id", matterId)
    .eq("role", "client")
    .limit(1)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return null;

  const { data: contact, error } = await supabase
    .from("crm_contact")
    .select("*")
    .eq("id", link.contact_id)
    .maybeSingle();
  if (error) throw error;
  return contact ?? null;
}
