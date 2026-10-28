import type { RecordKind, Skill } from "./catalog";

/**
 * "Run it on..." search over the firm's leads and matters. PURE. The page reads the lists it already has
 * (listLeads, listMatters); this narrows them, in memory, case-insensitively, and caps what is drawn.
 */

export const PICK_LIMIT = 8;
export const SEARCH_MAX = 80;

type LeadFields = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
};

type MatterFields = {
  id: string;
  type: string;
  title: string | null;
  mark_text: string | null;
  matter_number: string;
  owner_name: string | null;
};

export type PickRecord = {
  kind: RecordKind;
  id: string;
  label: string;
  detail: string | null;
  /** The text a search term is looked for in. */
  haystack: readonly string[];
  /** The matter's type code; null for a lead. */
  matterType: string | null;
  /**
   * How a picker ROW names it, when the picker wants more than `label` (New proposal and New document):
   * `name` is the bold line (the person), `secondary` the one quieter line under it. Absent for the Skills picker.
   */
  name?: string;
  secondary?: string | null;
};

/** A search term from the URL: first value, trimmed, at most 80 characters. */
export function normalizeTerm(raw: string | string[] | undefined | null): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? "").trim().slice(0, SEARCH_MAX).trim();
}

export function leadRecord(l: LeadFields): PickRecord {
  const person = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
  const business = l.business_name?.trim() ?? "";
  const email = l.email?.trim() || null;
  return {
    kind: "lead",
    id: l.id,
    label: business || person || email || "Unnamed lead",
    detail: [business && person ? person : null, email].filter(Boolean).join(" · ") || null,
    haystack: [l.first_name, l.last_name, person, business, email].filter((v): v is string => !!v),
    matterType: null,
  };
}

export function matterRecord(m: MatterFields): PickRecord {
  // The same order matterLabel uses (mark, else title, else number), without its docket-sized input type.
  const label = m.mark_text?.trim() || m.title?.trim() || m.matter_number;
  return {
    kind: "matter",
    id: m.id,
    label,
    detail: [m.matter_number !== label ? m.matter_number : null, m.owner_name?.trim() || null].filter(Boolean).join(" · ") || null,
    haystack: [m.title, m.mark_text, m.matter_number, m.owner_name].filter((v): v is string => !!v),
    matterType: m.type,
  };
}

export type Picked = {
  shown: PickRecord[];
  /** How many matched, before the cap. */
  total: number;
};

/**
 * The records of `kind` a skill can run on, narrowed by `term` and capped. The order is the caller's
 * (leads by last activity, matters newest first), so with no term this is the recent records.
 */
export function pickRecords(records: readonly PickRecord[], skill: Pick<Skill, "matterTypes">, kind: RecordKind, term: string, limit = PICK_LIMIT): Picked {
  const needle = normalizeTerm(term).toLowerCase();
  const matched = records.filter((r) => {
    if (r.kind !== kind) return false;
    if (kind === "matter" && skill.matterTypes && !(r.matterType && skill.matterTypes.includes(r.matterType))) return false;
    return !needle || r.haystack.some((h) => h.toLowerCase().includes(needle));
  });
  return { shown: matched.slice(0, limit), total: matched.length };
}
