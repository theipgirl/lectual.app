/**
 * The Lawmatics booth-lead request shapes — pure, and deliberately alone.
 *
 * THE ONLY PLACE LAWMATICS PATHS, HEADERS, FIELD NAMES AND TAG STRINGS LIVE.
 * Split out of `./contacts.ts` for one concrete reason: `scripts/backfill-lawmatics.ts`
 * is run by tsx, where the `@/*` alias does not resolve and `server-only` has
 * no business being imported (see scripts/backfill-contacts.ts). If the script
 * carried its own copy of the field mapping, the Saturday-night recovery path
 * would drift from the live one exactly when nobody has time to notice. So
 * this module imports NOTHING, and both the app and the script use it.
 *
 * TAGGING: WHAT THE LIVE API ACTUALLY SAID (Sept 3, from production logs).
 * Two wrong attempts are now ruled out by real 4xx responses, not by reading:
 *
 *   1. `POST /taggings { tagging: { taggable_type, taggable_id, tag_id } }`
 *      — borrowed from lawmatics-mcp's `create_lead`. Live: **404 "This
 *      resource path does not exist 👻"**. That endpoint is not on this API;
 *      that code had evidently never been exercised.
 *   2. `POST /tags { tag: { name } }` (Rails-style wrapper, same source)
 *      — live: **422 "Validation failed: Key can't be blank, Name can't be
 *      blank"**. The wrapper hid the fields; this endpoint takes a FLAT body.
 *
 * What the logs DID confirm working: `GET /tags` resolves names fine (both
 * "UGW 2026" and "Hot Lead" were found), and `POST /prospects` creates the
 * record (real ids came back: 19012877, 19012816, …).
 *
 * So tagging is back on Lawmatics' own documented endpoints, and the whole
 * resolve-id-then-associate dance is gone — `/tags/attach` takes tag NAMES
 * and, per the reference, creates any that don't exist yet:
 *
 *   `POST /tags/attach { matter_id, tags: ["UGW 2026", "Hot Lead"] }`
 *
 * AND, at completion, one `PUT /prospects/:id` carries the tags, the updated
 * contact fields and the assessment answers as a note in a single call — the
 * reference's own "Update Matter" example shows `tags` and `notes` accepted
 * side by side. Tags go through both paths deliberately: `/tags/attach`
 * returned 2xx historically but the tag was never visible on the record the
 * firm was looking at, so the PUT is the second, independent attempt rather
 * than a replacement.
 *
 * REQUEST bodies are FLAT JSON, `Content-Type: application/json`. RESPONSES
 * are JSON:API shaped (`{ data: { id, type, attributes } }`), which is why
 * `extractContactId` reads through `data`.
 *
 * Correcting anything the live API disagrees with is a change to this one
 * file — `contacts.ts` and the backfill script only ever read the constants
 * and builders below.
 */

/** The default Lawmatics REST base, shared with the read client. */
export const LAWMATICS_DEFAULT_BASE = "https://api.lawmatics.com/v1";

/** Plain JSON, per the reference. NOT `application/vnd.api+json`. */
export const LAWMATICS_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
} as const;

/** `POST {base}/prospects` — creates the lead (a matter, in Lawmatics' terms). */
export const LAWMATICS_CREATE_PATH = "/prospects";

/**
 * `POST {base}/tags/attach` — attaches tags to a matter BY NAME, creating any
 * that do not exist yet. No id resolution, no separate create call.
 */
export const LAWMATICS_TAG_ATTACH_PATH = "/tags/attach";

/** `PUT {base}/prospects/:id` — updates the matter: fields, tags and notes. */
export function prospectPath(contactId: string): string {
  return `${LAWMATICS_CREATE_PATH}/${encodeURIComponent(contactId)}`;
}

export interface LawmaticsContactInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  /** Free-text provenance, e.g. "Booth — UGW 2026". */
  source?: string;
}

/**
 * The `POST /prospects` body. Flat, per the reference:
 *   { first_name, last_name, email, phone?, company_name?, source? }
 *
 * Carries no tags — see the module header for why tagging is now always a
 * separate call.
 */
export function toContactPayload(input: LawmaticsContactInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
  };
  // Only send optional fields we actually have. An empty string is not the
  // same as "not provided" and would overwrite a real value on a merge.
  if (input.phone?.trim()) body.phone = input.phone.trim();
  if (input.companyName?.trim()) body.company_name = input.companyName.trim();
  if (input.source?.trim()) body.source = input.source.trim();
  return body;
}

/**
 * Lawmatics returns ids as strings ("6446448") but its own examples send
 * numeric ids as numbers. Send a number when the id is one, so the server
 * never has to coerce.
 */
export function asLawmaticsId(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

/**
 * `POST /tags/attach` — attaches tags to a matter by NAME.
 *
 * The reference's own example passes both an existing and a not-yet-existing
 * name ("Existing Tag", "Tag to Create"), so unknown names are created rather
 * than rejected. Always the full intended set, not a delta: attaching a tag
 * the record already carries is a no-op, and re-sending the event tag repairs
 * a capture whose first attempt lost it.
 */
export function toTagsPayload(contactId: string, tags: string[]): Record<string, unknown> {
  return { matter_id: asLawmaticsId(contactId), tags };
}

export interface LawmaticsProspectUpdate {
  /** Full intended tag set — same rule as toTagsPayload. */
  tags?: string[];
  /** Appended to the matter, not replacing what's there. */
  notes?: { name: string; body: string }[];
}

/**
 * `PUT /prospects/:id` — the completion-time update.
 *
 * The reference's "Update Matter" example carries `tags` and `notes` in the
 * same body, which is why the assessment answers and the temperature tag
 * arrive together the moment the attendee finishes, rather than in two
 * separate round trips.
 */
export function toProspectUpdatePayload(update: LawmaticsProspectUpdate): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (update.tags?.length) body.tags = update.tags;
  if (update.notes?.length) body.notes = update.notes;
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom fields — the answers, made MERGEABLE.
//
// A Lawmatics note cannot be merged into an email; only fields can. So the
// assessment goes to Lawmatics twice: as a note (readable) and as custom
// fields (mergeable, filterable). See src/lib/booth/answers-fields.ts.
//
// WHAT THE REFERENCE ACTUALLY SAYS, AND WHAT IT DOESN'T.
// "Update Matter" documents the behaviour but not the body: *"Passing Custom
// Field id and value, will set the custom field value on the Matter, and
// overwrite any existing value. Passing null as the value will clear it out."*
// Its example body carries only first_name/notes/tags — no custom field at all.
// Two candidate keys appear elsewhere in the same collection:
//
//   `custom_fields`       — the key the Update Matter RESPONSE uses, as
//                           [{ id, name, field_type, value, formatted_value }]
//   `custom_field_values` — the key `/collection_items` takes, as [{ id, value }]
//
// This file has already been wrong twice by picking the plausible-looking
// shape and shipping it (see the header). So it does not pick: it exports both,
// `syncLawmaticsCustomFields` tries them in order, and the log line says which
// one the server accepted. When production tells us, delete the loser — that
// is a one-line change here and nowhere else.
// ─────────────────────────────────────────────────────────────────────────────

/** `GET {base}/custom_fields` — the account's field metadata, incl. ids. */
export const LAWMATICS_CUSTOM_FIELDS_PATH = "/custom_fields";

/**
 * Candidate body keys for setting custom field values on `PUT /prospects/:id`,
 * most-likely first. `custom_fields` leads because it is the key the endpoint's
 * own response uses for exactly this data.
 */
export const LAWMATICS_CUSTOM_FIELD_BODY_KEYS = ["custom_fields", "custom_field_values"] as const;

export type LawmaticsCustomFieldBodyKey = (typeof LAWMATICS_CUSTOM_FIELD_BODY_KEYS)[number];

export interface LawmaticsCustomFieldValue {
  id: string;
  /** `null` clears the field, per the reference. */
  value: string | null;
}

/** One `PUT /prospects/:id` body carrying only custom field values. */
export function toCustomFieldsPayload(
  values: LawmaticsCustomFieldValue[],
  key: LawmaticsCustomFieldBodyKey,
): Record<string, unknown> {
  return { [key]: values.map((v) => ({ id: asLawmaticsId(v.id), value: v.value })) };
}

/**
 * Indexes a `GET /custom_fields` listing by lowercased name.
 *
 * Lowercased because the firm creates these in a web form and "Booth: Entity
 * Formed" vs "Booth: Entity formed" must not silently cost a field. Matter
 * fields only: Lawmatics scopes a custom field to one record type, and a
 * same-named Contact field would resolve to an id the matter PUT rejects.
 * `attributes.type` is Lawmatics' own name for that scope, and it is asymmetric:
 * `POST /custom_fields` takes "Matter", the record reads back as "Prospect"
 * (the reference's own Create example shows exactly that round trip). Both are
 * accepted here so a field created either way still resolves.
 */
export function indexCustomFieldsByName(records: unknown[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const attrs = (rec.attributes ?? {}) as Record<string, unknown>;
    const name = attrs.name;
    const scope = attrs.type;
    const id = rec.id;
    if (typeof name !== "string") continue;
    if (scope !== "Prospect" && scope !== "Matter") continue;
    const idStr = typeof id === "string" ? id : typeof id === "number" ? String(id) : null;
    if (!idStr) continue;
    byName.set(name.trim().toLowerCase(), idStr);
  }
  return byName;
}

/** Pulls an id out of whichever envelope shape comes back. */
export function extractContactId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const id = data?.id ?? data?.contact_id;
  return typeof id === "string" ? id : typeof id === "number" ? String(id) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags — CONTRACTS with a Lawmatics automation nobody in this repo can see.
//
// Don points the thank-you and the nurture sequence at these strings BY NAME.
// If one does not match exactly, the contact lands and no email ever sends —
// which looks like success from in here. Change them only alongside the
// automation. Both were confirmed by Taylor on Sept 2:
//   event        → "UGW 2026"; "Story2Profit 2026" added Oct 17 for the
//                  Trademark & Copyright card
//   temperature  → "Hot Lead" / "Warm Lead" / "Cold Lead"
// ─────────────────────────────────────────────────────────────────────────────

const LAWMATICS_EVENT_TAGS: Record<string, string> = {
  "urban-golf-2026": "UGW 2026",
  "story2profit-2026": "Story2Profit 2026",
};

export function lawmaticsTagFor(eventCode: string): string {
  return LAWMATICS_EVENT_TAGS[eventCode] ?? eventCode;
}

/**
 * Rebecca's ask, verbatim: "I wanna know if it's a hot lead, medium, or cool
 * lead… within Lawmatics. So that should be another tag." Our model is
 * hot / warm / cold; the tag names carry "Lead" so they read unambiguously in
 * a shared tag list that other automations also see.
 */
export const LAWMATICS_TEMPERATURE_TAGS = {
  hot: "Hot Lead",
  warm: "Warm Lead",
  cold: "Cold Lead",
} as const;

export type LawmaticsTemperature = keyof typeof LAWMATICS_TEMPERATURE_TAGS;

export function temperatureTagFor(temperature: LawmaticsTemperature): string {
  return LAWMATICS_TEMPERATURE_TAGS[temperature];
}

/**
 * Everything a COMPLETED booth contact should carry. An abandoned capture only
 * ever has the event tag — the missing temperature is itself the signal
 * ("started, didn't finish").
 */
export function boothContactTags(eventCode: string, temperature: LawmaticsTemperature): string[] {
  return [lawmaticsTagFor(eventCode), temperatureTagFor(temperature)];
}
