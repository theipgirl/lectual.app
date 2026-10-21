/**
 * Pure rules for a contact a person types (the matter page's Client contact
 * card). No DB and no server-only imports: the card's forms, the actions and
 * the data layer share these limits, and they are unit tested on their own.
 *
 * Every blank saves as null, so clearing a box genuinely clears the field.
 */

export const CONTACT_NAME_MAX = 100;
export const CONTACT_BUSINESS_MAX = 200;
export const CONTACT_EMAIL_MAX = 254;
export const CONTACT_PHONE_MAX = 40;
export const CONTACT_COMPANY_MAX = 200;

/** A search shorter than this returns nothing rather than the whole address book. */
export const CONTACT_SEARCH_MIN = 2;
export const CONTACT_SEARCH_LIMIT = 10;

/** What a form posted. A key left out means "leave this field alone". */
export type ContactFieldsInput = {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
};

/** The crm_contact columns a form can set. */
export type ContactColumns = {
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
};

export type ContactFieldsResult =
  | { ok: true; changes: Partial<ContactColumns>; fields: (keyof ContactColumns)[] }
  | { ok: false; error: string };

const FIELDS: Array<[keyof ContactFieldsInput, keyof ContactColumns, number, string]> = [
  ["firstName", "first_name", CONTACT_NAME_MAX, "First name"],
  ["lastName", "last_name", CONTACT_NAME_MAX, "Last name"],
  ["businessName", "business_name", CONTACT_BUSINESS_MAX, "Business name"],
  ["email", "email", CONTACT_EMAIL_MAX, "Email"],
  ["phone", "phone", CONTACT_PHONE_MAX, "Phone"],
  ["companyName", "company_name", CONTACT_COMPANY_MAX, "Company"],
];

/** Plausible, not provable: one @, no spaces, a dot in the domain. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** How a contact reads in a list: business name, else "First Last", else the email. */
export function contactLabel(c: Pick<ContactColumns, "first_name" | "last_name" | "business_name" | "email">): string {
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.business_name?.trim() || full || c.email?.trim() || "Unnamed contact";
}

/**
 * Normalises a posted contact against the contact as it is now (all-null for a
 * new one) and returns ONLY the columns that change. After the change a name or
 * a business name must remain; email, when given, must look like an address.
 */
export function validateContactFields(
  input: ContactFieldsInput,
  current: ContactColumns | null,
): ContactFieldsResult {
  const before: ContactColumns = current ?? {
    first_name: null,
    last_name: null,
    business_name: null,
    email: null,
    phone: null,
    company_name: null,
  };
  const changes: Partial<ContactColumns> = {};
  for (const [key, column, max, label] of FIELDS) {
    if (input[key] === undefined) continue;
    const next = blankToNull(input[key]);
    if (next !== null && next.length > max) {
      return { ok: false, error: `${label} must be ${max} characters or fewer.` };
    }
    if (column === "email" && next !== null && !isPlausibleEmail(next)) {
      return { ok: false, error: "Enter a valid email address, like name@example.com." };
    }
    if (next !== before[column]) changes[column] = next;
  }

  const after = { ...before, ...changes };
  if (!after.first_name && !after.last_name && !after.business_name) {
    return { ok: false, error: "A contact needs a first name, a last name or a business name." };
  }
  return { ok: true, changes, fields: Object.keys(changes) as (keyof ContactColumns)[] };
}

/**
 * A LIKE pattern that matches the text literally: `\`, `%` and `_` are
 * escaped so a search for "50%" is not a wildcard.
 */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * One value for a PostgREST `.or()` filter, double-quoted so commas, dots and
 * parentheses in the person's text stay text instead of ending the filter.
 */
export function postgrestQuote(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/** The words of a search, capped so a pasted paragraph can't build a huge filter. */
export function searchTokens(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
}
