/**
 * Lawmatics record → sanitized source record.
 *
 * EVERY VALUE HERE IS UNTRUSTED. It arrives from a third-party API over the
 * network and ends up in a multi-tenant database and in HTML. Nothing is passed
 * through raw: control characters are stripped, whitespace is collapsed, every
 * field is length-capped, emails must parse, and URLs must be http(s) (a
 * `javascript:` "website" on a client record would otherwise become a live
 * link in the pipeline UI). Fields that fail validation become null rather
 * than being coerced into something plausible — the importer reports the gap
 * instead of inventing a value.
 *
 * Pure module: no I/O. Unit-tested against fixtures.
 */

import {
  bag,
  field,
  idOf,
  nestedName,
  related,
  relatedId,
  relatedName,
  type Raw,
} from "./jsonapi";

// Field caps. Generous enough for real data, small enough that a hostile
// payload can't bloat a row. crm_lead's columns are unbounded `text`.
const CAP = {
  id: 128,
  name: 120,
  email: 320,
  phone: 40,
  business: 200,
  website: 500,
  stage: 200,
  // Same cap matters-normalize.ts uses for the equivalent field.
  referralSource: 200,
} as const;

/**
 * Strip C0/C1 control characters (including the bidi/zero-width troublemakers
 * that make a display name lie about what it is), collapse whitespace, trim,
 * and cap. Returns null for anything that ends up empty.
 */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const stripped = value
    // C0 + DEL + C1 control characters -> space.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    // Zero-width / bidi-override characters: invisible, and able to make a
    // stored display name render as something other than what it is.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.slice(0, max);
}

/**
 * Conservative email validation. Deliberately stricter than RFC 5322: one `@`,
 * no whitespace, a dotted domain. A Lawmatics record whose email doesn't pass
 * is reported as unusable, never guessed at.
 */
export function cleanEmail(value: unknown): string | null {
  const text = cleanText(value, CAP.email);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (!/^[^\s@,;<>"']+@[^\s@,;<>"'.]+(\.[^\s@,;<>"'.]+)+$/.test(lowered)) {
    return null;
  }
  return lowered;
}

/** Keep only characters a phone number can legitimately contain. */
export function cleanPhone(value: unknown): string | null {
  const text = cleanText(value, CAP.phone);
  if (!text) return null;
  const kept = text.replace(/[^0-9+().\-\s x]/gi, "").trim();
  if (!/\d/.test(kept)) return null;
  return kept.slice(0, CAP.phone);
}

/**
 * Normalize a website to an absolute http(s) URL. A bare domain gets an
 * `https://` prefix; anything with another scheme (javascript:, data:, file:)
 * is rejected outright rather than sanitized-in-place.
 */
export function cleanWebsite(value: unknown): string | null {
  const text = cleanText(value, CAP.website);
  if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString().slice(0, CAP.website);
}

/** An ISO timestamp, or null. Never a fabricated "now". */
export function cleanTimestamp(value: unknown): string | null {
  const text = cleanText(value, 64);
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Split a single display name into first/last. Everything before the final
 * space is the first name — the usual least-wrong heuristic for Western-ordered
 * names, and the importer shows the result in the preview before anything is
 * written. A mononym becomes the last name (the surname column is what the
 * pipeline sorts and displays on).
 */
export function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.split(" ").filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: null, last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/**
 * One Lawmatics prospect (a "Matter" in their UI), flattened and sanitized.
 * `null` everywhere means "Lawmatics didn't give us this", never "empty".
 */
export type LawmaticsSourceRecord = {
  lawmaticsId: string;
  /** Prospect/matter name as shown in Lawmatics — for the preview only. */
  matterName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  website: string | null;
  /** Stage name exactly as Lawmatics spells it. Mapped later, never guessed. */
  stageName: string | null;
  practiceArea: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Related contact id, so a separately-fetched contact can be merged in. */
  contactId: string | null;
  /**
   * Verbatim referral-source text — attribute key not confirmed against a
   * live account (same caveat matters-normalize.ts documents for its own
   * copy of this field), so every plausible flat spelling is tried. `null`
   * means Lawmatics simply didn't expose it, not "blank" — import-plan.ts
   * relies on that distinction to avoid stamping a bucket from silence.
   */
  referralSource: string | null;
};

/** A sanitized Lawmatics contact, used to enrich prospects that lack details. */
export type LawmaticsSourceContact = {
  lawmaticsId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  website: string | null;
};

function namesFrom(rec: Raw): { first: string | null; last: string | null } {
  const first = cleanText(field(rec, "first_name", "firstName"), CAP.name);
  const last = cleanText(field(rec, "last_name", "lastName"), CAP.name);
  if (first || last) return { first, last };
  const full = cleanText(field(rec, "full_name", "name"), CAP.name * 2);
  return full ? splitName(full) : { first: null, last: null };
}

/** Sanitize a Lawmatics contact record (flat or JSON:API enveloped). */
export function normalizeContact(rec: Raw): LawmaticsSourceContact | null {
  const id = cleanText(idOf(rec), CAP.id);
  if (!id) return null;
  const { first, last } = namesFrom(rec);
  return {
    lawmaticsId: id,
    firstName: first,
    lastName: last,
    email: cleanEmail(field(rec, "email", "email_address", "primary_email")),
    phone: cleanPhone(
      field(rec, "phone", "phone_number", "cell_phone", "mobile_phone", "work_phone"),
    ),
    businessName: cleanText(
      field(rec, "company", "company_name", "organization", "business_name") ??
        nestedName(rec, "company"),
      CAP.business,
    ),
    website: cleanWebsite(field(rec, "website", "url", "company_website")),
  };
}

/**
 * Sanitize a Lawmatics prospect. `included` is the sideload index from the
 * same response — stage, practice area and the related contact are
 * relationships, so without it those fields simply read as null.
 */
export function normalizeProspect(
  rec: Raw,
  included: Map<string, Raw> = new Map(),
): LawmaticsSourceRecord | null {
  const id = cleanText(idOf(rec), CAP.id);
  if (!id) return null;

  const contactRec = related(rec, "contact", included) ?? related(rec, "client", included);
  const contact = contactRec ? normalizeContact(contactRec) : null;

  const own = namesFrom(rec);
  const attrs = bag(rec);
  const matterName = cleanText(attrs.name ?? attrs.matter_name ?? attrs.title, CAP.name * 2);

  return {
    lawmaticsId: id,
    matterName,
    firstName: own.first ?? contact?.firstName ?? null,
    lastName: own.last ?? contact?.lastName ?? null,
    email:
      cleanEmail(field(rec, "email", "email_address", "primary_email")) ??
      contact?.email ??
      null,
    phone:
      cleanPhone(field(rec, "phone", "phone_number", "cell_phone", "mobile_phone")) ??
      contact?.phone ??
      null,
    businessName:
      cleanText(
        field(rec, "company", "company_name", "organization", "business_name") ??
          nestedName(rec, "company"),
        CAP.business,
      ) ??
      contact?.businessName ??
      null,
    website:
      cleanWebsite(field(rec, "website", "url", "company_website")) ??
      contact?.website ??
      null,
    stageName: cleanText(relatedName(rec, "stage", included), CAP.stage),
    practiceArea: cleanText(relatedName(rec, "practice_area", included), CAP.stage),
    createdAt: cleanTimestamp(field(rec, "created_at", "created")),
    updatedAt: cleanTimestamp(field(rec, "updated_at", "updated")),
    contactId:
      relatedId(rec, "contact") ??
      relatedId(rec, "client") ??
      cleanText(field(rec, "contact_id"), CAP.id),
    referralSource: cleanText(
      field(rec, "referral_source", "source", "lead_source", "referred_by"),
      CAP.referralSource,
    ),
  };
}

/**
 * Fill a prospect's blanks from a separately-fetched contact. Only ever fills
 * nulls — a value already on the prospect wins, and a contact can never blank
 * something out.
 *
 * `referralSource` is deliberately left untouched: a contact record has no
 * notion of how the prospect it's attached to was referred, so there is
 * nothing legitimate to merge in for that field.
 */
export function mergeContact(
  record: LawmaticsSourceRecord,
  contact: LawmaticsSourceContact | undefined,
): LawmaticsSourceRecord {
  if (!contact) return record;
  return {
    ...record,
    firstName: record.firstName ?? contact.firstName,
    lastName: record.lastName ?? contact.lastName,
    email: record.email ?? contact.email,
    phone: record.phone ?? contact.phone,
    businessName: record.businessName ?? contact.businessName,
    website: record.website ?? contact.website,
  };
}
