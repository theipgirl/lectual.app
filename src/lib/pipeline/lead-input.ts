/**
 * Pure validation/normalisation for the lead contact fields a human types.
 *
 * Deliberately dependency-free and DB-free: it is imported by the data layer
 * (createLead / updateLead) *and* by the server actions that back the forms,
 * so the same rules run whether a write arrives from the New-lead dialog, the
 * edit form, or a future API caller (defense in depth — RLS is still the real
 * boundary, this is just the friendly layer in front of it).
 *
 * Everything here returns field-keyed messages meant to be shown to a user.
 * No Postgres/RLS text ever reaches these strings.
 */

export type LeadContactInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  businessName?: string | null;
  website?: string | null;
};

export type LeadField = keyof LeadContactInput;

export type LeadFieldErrors = Partial<Record<LeadField, string>>;

/** Column-shaped result — ready to hand straight to a crm_lead insert/update. */
export type LeadContactColumns = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  website: string | null;
};

export type Validated<T, E = LeadFieldErrors> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: E };

const MAX = {
  name: 120,
  business: 200,
  email: 254,
  phone: 40,
  website: 500,
} as const;

// Intentionally permissive: the job here is to catch typos and obvious
// garbage, not to re-derive RFC 5322. Deliverability is not our claim.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when the caller explicitly supplied the key (edit forms send every field). */
function provided(input: LeadContactInput, key: LeadField): boolean {
  return Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
}

function checkRequiredText(
  raw: string,
  label: string,
  max: number,
): { value: string } | { error: string } {
  if (!raw) return { error: `${label} is required.` };
  if (raw.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  return { value: raw };
}

function checkOptionalText(
  raw: string,
  label: string,
  max: number,
): { value: string | null } | { error: string } {
  if (!raw) return { value: null };
  if (raw.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  return { value: raw };
}

/** Normalises an email to lowercase and rejects anything without a plausible shape. */
export function normalizeEmail(raw: string): { value: string } | { error: string } {
  const email = trimmed(raw).toLowerCase();
  if (!email) return { error: "Email is required." };
  if (email.length > MAX.email) return { error: `Email must be ${MAX.email} characters or fewer.` };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address, e.g. name@firm.com." };
  return { value: email };
}

/**
 * Keeps the phone number as typed (firms paste all sorts of formats and the
 * column is free text) but insists on at least 7 digits so an obvious typo
 * doesn't become a dead contact record.
 */
export function normalizePhone(raw: string): { value: string | null } | { error: string } {
  const phone = trimmed(raw);
  if (!phone) return { value: null };
  if (phone.length > MAX.phone) return { error: `Phone must be ${MAX.phone} characters or fewer.` };
  if (!/^[+()\-.\s\dxX]+$/.test(phone)) {
    return { error: "Phone can only contain digits and + ( ) - . x characters." };
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return { error: "Enter a full phone number (at least 7 digits)." };
  return { value: phone };
}

/**
 * Accepts what a person actually types ("doestudio.com") and stores a real
 * absolute URL. Anything that isn't http/https is refused rather than silently
 * rewritten — a `javascript:` value must never reach an <a href> on the
 * lead-detail page.
 */
export function normalizeWebsite(raw: string): { value: string | null } | { error: string } {
  const input = trimmed(raw);
  if (!input) return { value: null };
  if (input.length > MAX.website) {
    return { error: `Website must be ${MAX.website} characters or fewer.` };
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: "Enter a valid website, e.g. example.com." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Website must be an http:// or https:// address." };
  }
  if (!url.hostname.includes(".")) {
    return { error: "Enter a valid website, e.g. example.com." };
  }
  return { value: url.toString() };
}

/**
 * Full validation for a brand-new lead: first name, last name and email are
 * required (they mirror the NOT NULL columns on crm_lead); everything else is
 * optional and normalised to null when blank.
 */
export function validateNewLead(input: LeadContactInput): Validated<LeadContactColumns> {
  const fieldErrors: LeadFieldErrors = {};

  const first = checkRequiredText(trimmed(input.firstName), "First name", MAX.name);
  if ("error" in first) fieldErrors.firstName = first.error;

  const last = checkRequiredText(trimmed(input.lastName), "Last name", MAX.name);
  if ("error" in last) fieldErrors.lastName = last.error;

  const email = normalizeEmail(trimmed(input.email));
  if ("error" in email) fieldErrors.email = email.error;

  const phone = normalizePhone(trimmed(input.phone));
  if ("error" in phone) fieldErrors.phone = phone.error;

  const business = checkOptionalText(trimmed(input.businessName), "Business name", MAX.business);
  if ("error" in business) fieldErrors.businessName = business.error;

  const website = normalizeWebsite(trimmed(input.website));
  if ("error" in website) fieldErrors.website = website.error;

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      first_name: (first as { value: string }).value,
      last_name: (last as { value: string }).value,
      email: (email as { value: string }).value,
      phone: (phone as { value: string | null }).value,
      business_name: (business as { value: string | null }).value,
      website: (website as { value: string | null }).value,
    },
  };
}

/**
 * Validation for an edit: only the keys the caller actually supplied are
 * validated and returned, so a partial patch never blanks a column the form
 * didn't render. Supplying an empty first/last/email is still an error — those
 * columns are NOT NULL and a blank one would destroy the contact record.
 */
export function validateLeadEdit(
  input: LeadContactInput,
): Validated<Partial<LeadContactColumns>> {
  const fieldErrors: LeadFieldErrors = {};
  const value: Partial<LeadContactColumns> = {};

  if (provided(input, "firstName")) {
    const first = checkRequiredText(trimmed(input.firstName), "First name", MAX.name);
    if ("error" in first) fieldErrors.firstName = first.error;
    else value.first_name = first.value;
  }
  if (provided(input, "lastName")) {
    const last = checkRequiredText(trimmed(input.lastName), "Last name", MAX.name);
    if ("error" in last) fieldErrors.lastName = last.error;
    else value.last_name = last.value;
  }
  if (provided(input, "email")) {
    const email = normalizeEmail(trimmed(input.email));
    if ("error" in email) fieldErrors.email = email.error;
    else value.email = email.value;
  }
  if (provided(input, "phone")) {
    const phone = normalizePhone(trimmed(input.phone));
    if ("error" in phone) fieldErrors.phone = phone.error;
    else value.phone = phone.value;
  }
  if (provided(input, "businessName")) {
    const business = checkOptionalText(trimmed(input.businessName), "Business name", MAX.business);
    if ("error" in business) fieldErrors.businessName = business.error;
    else value.business_name = business.value;
  }
  if (provided(input, "website")) {
    const website = normalizeWebsite(trimmed(input.website));
    if ("error" in website) fieldErrors.website = website.error;
    else value.website = website.value;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}

/**
 * Field-level diff for the audit payload. Only keys whose value actually
 * changed are returned, so an edit that touched nothing logs nothing —
 * a timeline full of no-op "lead updated" rows is worse than none.
 */
export function diffLeadColumns(
  before: Partial<LeadContactColumns>,
  patch: Partial<LeadContactColumns>,
): Record<string, { from: string | null; to: string | null }> {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const [key, next] of Object.entries(patch) as [
    keyof LeadContactColumns,
    string | null | undefined,
  ][]) {
    if (next === undefined) continue;
    const prev = before[key] ?? null;
    const to = next ?? null;
    if (prev !== to) changes[key] = { from: prev, to };
  }
  return changes;
}

export const NOTE_MAX_LENGTH = 5000;

/** Note/call/email-log kinds a human can write from the lead timeline composer. */
export const NOTE_KINDS = ["note", "call_logged", "email_sent"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === "string" && (NOTE_KINDS as readonly string[]).includes(value);
}

export type NoteFieldErrors = Partial<Record<"kind" | "body" | "subject", string>>;

/** Pure validation for the note composer. */
export function validateNote(input: {
  kind?: string | null;
  body?: string | null;
  subject?: string | null;
}): Validated<{ kind: NoteKind; body: string; subject: string | null }, NoteFieldErrors> {
  const fieldErrors: NoteFieldErrors = {};

  const kind = input.kind ?? "note";
  if (!isNoteKind(kind)) fieldErrors.kind = "Choose a valid entry type.";

  const body = trimmed(input.body);
  if (!body) fieldErrors.body = "Write something before saving.";
  else if (body.length > NOTE_MAX_LENGTH) {
    fieldErrors.body = `Keep it under ${NOTE_MAX_LENGTH} characters.`;
  }

  const subject = trimmed(input.subject);
  if (subject.length > 200) fieldErrors.subject = "Subject must be 200 characters or fewer.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: { kind: kind as NoteKind, body, subject: subject || null },
  };
}
