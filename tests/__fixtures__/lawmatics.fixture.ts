/**
 * Lawmatics API fixtures.
 *
 * Hand-built from the documented JSON:API response shape (lawmatics-mcp
 * CLAUDE.md + src/dashboard-lawmatics.ts): `{ data, included, meta }`, records
 * carrying an `attributes` bag, and stage / practice_area / contact expressed
 * as `relationships` that only resolve through `included`.
 *
 * NO REAL CLIENT DATA. Every person, firm and address here is invented. These
 * fixtures exist precisely so the importer can be exercised without ever
 * touching the live Lawmatics account.
 */

export type FixtureProspect = {
  id: string;
  matterName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  stage?: string;
  practiceArea?: string;
  createdAt?: string;
  updatedAt?: string;
  contactId?: string;
};

export type FixtureContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
};

type Raw = Record<string, unknown>;

function stageId(name: string): string {
  return `stage-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** Build a JSON:API `/prospects` page, with stage/contact sideloaded. */
export function prospectsPayload(
  prospects: FixtureProspect[],
  opts: { contacts?: FixtureContact[]; totalPages?: number } = {},
): Raw {
  const included: Raw[] = [];
  const seenStages = new Set<string>();

  const data: Raw[] = prospects.map((p) => {
    const relationships: Raw = {};

    if (p.stage) {
      const id = stageId(p.stage);
      relationships.stage = { data: { type: "stage", id } };
      if (!seenStages.has(id)) {
        seenStages.add(id);
        included.push({ type: "stage", id, attributes: { name: p.stage } });
      }
    }
    if (p.practiceArea) {
      const id = `pa-${p.practiceArea.toLowerCase()}`;
      relationships.practice_area = { data: { type: "practice_area", id } };
      if (!seenStages.has(id)) {
        seenStages.add(id);
        included.push({ type: "practice_area", id, attributes: { name: p.practiceArea } });
      }
    }
    if (p.contactId) {
      relationships.contact = { data: { type: "contact", id: p.contactId } };
    }

    return {
      type: "prospect",
      id: p.id,
      attributes: {
        name: p.matterName,
        first_name: p.firstName,
        last_name: p.lastName,
        email: p.email,
        phone: p.phone,
        company: p.company,
        website: p.website,
        created_at: p.createdAt ?? "2026-01-14T09:30:00Z",
        updated_at: p.updatedAt ?? "2026-06-02T16:05:00Z",
      },
      relationships,
    };
  });

  // Contacts referenced by a prospect are sideloaded, exactly as the live API
  // does when `include=contact` is honoured.
  for (const c of opts.contacts ?? []) {
    included.push(contactRecord(c));
  }

  return {
    data,
    included,
    meta: { total_pages: opts.totalPages ?? 1, total_entries: prospects.length },
    links: {},
  };
}

export function contactRecord(c: FixtureContact): Raw {
  return {
    type: "contact",
    id: c.id,
    attributes: {
      first_name: c.firstName,
      last_name: c.lastName,
      email: c.email,
      phone: c.phone,
      company: c.company,
      website: c.website,
    },
  };
}

/** Build a JSON:API `/contacts` page. */
export function contactsPayload(
  contacts: FixtureContact[],
  opts: { totalPages?: number } = {},
): Raw {
  return {
    data: contacts.map(contactRecord),
    meta: { total_pages: opts.totalPages ?? 1, total_entries: contacts.length },
    links: {},
  };
}

/** RPB Law's 21 SOP stages, as seeded by supabase/migrations/0028. */
export const RPB_STAGE_NAMES = [
  "Follow-Up",
  "Potential New Client",
  "Preliminary Search",
  "Consultation Scheduled",
  "Post Consultation Email Sent",
  "Undecided / Questions",
  "LOE & Invoice Sent",
  "Signed LOE / Deposit Received",
  "Questionnaire Complete",
  "Comprehensive Search",
  "Preparing Opinion Letter",
  "Opinion Letter Sent",
  "Application Preparation",
  "Consent to File Application",
  "Application Ready for Filing",
  "Send Invoice for Remaining Balance",
  "Full Balance Received",
  "Application Filed",
  "Awaiting Trademark Registration",
  "Publication for Opposition",
  "Trademark Registered",
] as const;

/** The 7-stage default every new org is seeded with (migration 0017). */
export const DEFAULT_STAGE_NAMES = [
  "New PNC",
  "Discovery Call",
  "Strategy Session",
  "Pending LOE + Payment",
  "Hired Client",
  "Nurture",
  "Lost",
] as const;

/** Turn stage names into `{ id, name }` refs the mapper accepts. */
export function stageRefs(names: readonly string[]): Array<{ id: string; name: string }> {
  return names.map((name) => ({ id: stageId(name), name }));
}
