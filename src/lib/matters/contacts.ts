import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";
import { logActivitySafe } from "./activity";
import { recordNotFoundError } from "./not-found";
import {
  CONTACT_SEARCH_LIMIT,
  CONTACT_SEARCH_MIN,
  likeEscape,
  postgrestQuote,
  searchTokens,
  validateContactFields,
  type ContactFieldsInput,
} from "./contact-input";

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
 * Links a contact to a matter (role defaults to 'client'), IDEMPOTENTLY. BOTH
 * ids are resolved through the CALLER'S OWN scoped client first — never trusted
 * verbatim off the input — so an id belonging to another org is simply
 * invisible (RLS already hides it) before any crm_matter_contact row is ever
 * written, and org_id on the join row is read off the MATTER, never the
 * caller. This is the exact discipline applyTag (src/lib/pipeline/tags.ts)
 * uses for crm_lead_tag, the one other join table with this
 * org_id-denormalized / no-composite-FK shape. See 0048's header comment.
 *
 * The table has a unique key on (matter, contact, role). Linking a contact that
 * is already linked returns the existing link (created: false) instead of
 * surfacing that key as a raw database error, so a double click or a retry after
 * a half-failed add can't produce a second row.
 */
export async function ensureMatterContactLink(
  matterId: string,
  contactId: string,
  role: string = "client",
): Promise<{ link: MatterContactLink; created: boolean }> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("org_id")
    .eq("id", matterId)
    .maybeSingle();
  if (matterError) throw matterError;
  if (!matter) throw recordNotFoundError("matter");

  // Confirms the contact is actually visible under RLS (i.e. belongs to the
  // caller's own org) before it can be paired with the matter.
  const { data: contact, error: contactError } = await supabase
    .from("crm_contact")
    .select("id")
    .eq("id", contactId)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact) throw recordNotFoundError("contact");

  const findExisting = async () => {
    const { data, error } = await supabase
      .from("crm_matter_contact")
      .select("*")
      .eq("matter_id", matterId)
      .eq("contact_id", contact.id)
      .eq("role", role)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  const existing = await findExisting();
  if (existing) return { link: existing, created: false };

  const { data, error } = await supabase
    .from("crm_matter_contact")
    .insert({ org_id: matter.org_id, matter_id: matterId, contact_id: contact.id, role })
    .select("*")
    .single();
  if (error) {
    // Lost a race to the unique key: the other request's link is the link.
    if ((error as { code?: string }).code === "23505") {
      const raced = await findExisting();
      if (raced) return { link: raced, created: false };
    }
    throw error;
  }
  return { link: data, created: true };
}

/** Same as ensureMatterContactLink, for callers that only want the link row. */
export async function linkMatterContact(
  matterId: string,
  contactId: string,
  role: string = "client",
): Promise<MatterContactLink> {
  return (await ensureMatterContactLink(matterId, contactId, role)).link;
}

/**
 * Links an existing contact to the matter and records "Contact linked" on the
 * matter's timeline. A contact that was already linked writes no second link and
 * no second timeline row. The row names the contact id, never the email or phone.
 */
export async function linkContactToMatter(
  matterId: string,
  contactId: string,
): Promise<{ link: MatterContactLink; created: boolean }> {
  const result = await ensureMatterContactLink(matterId, contactId);
  if (result.created) {
    await logActivitySafe({
      type: "matter_updated",
      matterId,
      payload: { change: "contact_linked", contact_id: contactId, role: result.link.role },
    });
  }
  return result;
}

export type AddedContact = {
  contact: Contact;
  /** False when the email already belonged to a contact of this firm and that contact was used. */
  contactCreated: boolean;
  /** False when that contact was already linked to this matter. */
  linkCreated: boolean;
};

/**
 * Adds a new contact and links it to the matter. org_id comes from the session
 * (createContact), never the form. The matter is resolved first, so another
 * firm's matter id creates nothing.
 *
 * A "new" contact whose email matches a contact already in this firm
 * (case-insensitive) is not duplicated: that contact is linked instead, and the
 * result says so. If the link fails after the contact was created, the error
 * says the contact was saved but not linked, so the person doesn't add it twice.
 */
export async function addContactToMatter(matterId: string, input: ContactFieldsInput): Promise<AddedContact> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const checked = validateContactFields(input, null);
  if (!checked.ok) throw new Error(checked.error);

  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("id")
    .eq("id", matterId)
    .maybeSingle();
  if (matterError) throw matterError;
  if (!matter) throw recordNotFoundError("matter");

  const email = checked.changes.email ?? null;
  if (email) {
    const { data: matches, error: matchError } = await supabase
      .from("crm_contact")
      .select("*")
      .ilike("email", likeEscape(email))
      .order("created_at", { ascending: true })
      .limit(1);
    if (matchError) throw matchError;
    const match = matches?.[0];
    if (match) {
      const { created } = await linkContactToMatter(matterId, match.id);
      return { contact: match, contactCreated: false, linkCreated: created };
    }
  }

  const contact = await createContact({
    firstName: checked.changes.first_name,
    lastName: checked.changes.last_name,
    businessName: checked.changes.business_name,
    email,
    phone: checked.changes.phone,
    companyName: checked.changes.company_name,
  });

  try {
    await ensureMatterContactLink(matterId, contact.id);
  } catch {
    throw new Error(
      "The contact was saved, but couldn't be linked to this matter. Search for them under Link or add contact and choose Link.",
    );
  }
  await logActivitySafe({
    type: "matter_updated",
    matterId,
    payload: { change: "contact_added", contact_id: contact.id, role: "client" },
  });
  return { contact, contactCreated: true, linkCreated: true };
}

/**
 * Edits a linked contact's name, email, phone or company. Only a contact linked
 * to THIS matter can be edited from it (an id that is not linked here, or that
 * belongs to another firm, is "not found"). A contact is a shared record: the
 * change shows everywhere the contact is linked. Only the changed fields are
 * written; the timeline row names them and carries no values.
 */
export async function updateContact(
  matterId: string,
  contactId: string,
  input: ContactFieldsInput,
): Promise<{ contact: Contact; fields: string[] }> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: link, error: linkError } = await supabase
    .from("crm_matter_contact")
    .select("id")
    .eq("matter_id", matterId)
    .eq("contact_id", contactId)
    .limit(1)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) throw recordNotFoundError("contact");

  const { data: current, error: readError } = await supabase
    .from("crm_contact")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw recordNotFoundError("contact");

  const checked = validateContactFields(input, current);
  if (!checked.ok) throw new Error(checked.error);
  if (checked.fields.length === 0) return { contact: current, fields: [] };

  const { data, error } = await supabase
    .from("crm_contact")
    .update({ ...checked.changes, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .select("*")
    .single();
  if (error) throw error;

  await logActivitySafe({
    type: "matter_updated",
    matterId,
    payload: { change: "contact_edited", contact_id: contactId, fields: checked.fields },
  });
  return { contact: data, fields: checked.fields };
}

export type ContactSearchHit = Contact & { linked: boolean };

/**
 * `error` is a failed read, never an empty list: the card says it couldn't
 * search instead of "no matches".
 */
export type ContactSearchResult =
  | { status: "ok"; contacts: ContactSearchHit[]; tooShort: boolean }
  | { status: "error" };

/**
 * Searches THIS firm's contacts (RLS) by name, business name or email,
 * case-insensitively, for the "Link or add contact" panel. At least
 * CONTACT_SEARCH_MIN characters, at most CONTACT_SEARCH_LIMIT results. Each word
 * of the query must match one of the columns, so "ana smith" finds Ana Smith.
 *
 * The person's text is only ever text: `%` and `_` are escaped for LIKE, and the
 * pattern is double-quoted in the PostgREST filter so commas and parentheses
 * can't end it early. Each hit says whether it is already linked to the matter.
 */
export async function searchContacts(matterId: string, query: string): Promise<ContactSearchResult> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const trimmed = query.trim();
  if (trimmed.length < CONTACT_SEARCH_MIN) return { status: "ok", contacts: [], tooShort: true };

  try {
    let request = supabase.from("crm_contact").select("*");
    for (const token of searchTokens(trimmed)) {
      const pattern = postgrestQuote(`%${likeEscape(token)}%`);
      request = request.or(
        ["first_name", "last_name", "business_name", "email"].map((column) => `${column}.ilike.${pattern}`).join(","),
      );
    }
    const { data, error } = await request
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })
      .limit(CONTACT_SEARCH_LIMIT);
    if (error) throw error;
    const found = data ?? [];
    if (found.length === 0) return { status: "ok", contacts: [], tooShort: false };

    const { data: links, error: linkError } = await supabase
      .from("crm_matter_contact")
      .select("contact_id")
      .eq("matter_id", matterId)
      .in("contact_id", found.map((c) => c.id));
    if (linkError) throw linkError;
    const linked = new Set((links ?? []).map((l) => l.contact_id));
    return { status: "ok", contacts: found.map((c) => ({ ...c, linked: linked.has(c.id) })), tooShort: false };
  } catch (err) {
    console.error("[matter-contacts] contact search failed", err);
    return { status: "error" };
  }
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
 * (yet). When more than one client-role link exists, the OLDEST link wins.
 */
export async function primaryClientContact(matterId: string): Promise<Contact | null> {
  const supabase = await getScopedClient();

  const { data: link, error: linkError } = await supabase
    .from("crm_matter_contact")
    .select("contact_id")
    .eq("matter_id", matterId)
    .eq("role", "client")
    // Oldest link first: with a co-client linked, "first" must not depend on
    // whatever order the database happens to return.
    .order("created_at", { ascending: true })
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

/** A linked contact with the link it came through. */
export type LinkedContact = Contact & { link_id: string; role: string; linked_at: string };

/**
 * Three states, never two: `linked` (at least one contact), `none` (the read
 * worked and nothing is linked) and `unavailable` (the read failed). The matter
 * page's Client contact card and its header name both read this, so a database
 * error can't render as "No contact linked yet." or take the page down.
 */
export type MatterContactsRead =
  | { status: "linked"; contacts: LinkedContact[] }
  | { status: "none" }
  | { status: "unavailable" };

/** Every contact linked to a matter, oldest link first, with the three read states. */
export async function loadMatterContacts(matterId: string): Promise<MatterContactsRead> {
  try {
    const supabase = await getScopedClient();
    const { data: links, error: linkError } = await supabase
      .from("crm_matter_contact")
      .select("id, contact_id, role, created_at")
      .eq("matter_id", matterId)
      .order("created_at", { ascending: true });
    if (linkError) throw linkError;
    if (!links || links.length === 0) return { status: "none" };

    const { data: contacts, error } = await supabase
      .from("crm_contact")
      .select("*")
      .in("id", [...new Set(links.map((l) => l.contact_id))]);
    if (error) throw error;

    const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
    const linked = links.flatMap((l) => {
      const contact = byId.get(l.contact_id);
      return contact ? [{ ...contact, link_id: l.id, role: l.role, linked_at: l.created_at }] : [];
    });
    // A link whose contact can't be read is a failed read, not an empty card.
    if (linked.length === 0) return { status: "unavailable" };
    return { status: "linked", contacts: linked };
  } catch (err) {
    console.error("[matter-contacts] could not load the linked contacts", err);
    return { status: "unavailable" };
  }
}
