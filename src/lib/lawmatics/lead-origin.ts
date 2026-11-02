/**
 * Where a Lawmatics person really came from. PURE, no I/O.
 *
 * Lawmatics never exposes a "source" attribute, so the origin is read from what the firm's intake
 * collects: the "How did you hear about us?" question (a multi-picklist), "Referred By" and "Specify
 * Source" (free text), and event tags such as "UGW 2026". Custom fields are matched by NAME (another
 * firm's field ids differ); the RPB ids are only a fallback for an entry that carries no name.
 *
 * Silence is unknown: no answer gives `{ source: null, detail: null }`, never "Lawmatics" and never
 * "Inbound". Only an explicit "Source: Direct" tag says Inbound.
 *
 * Untrusted input: every detail is stripped of control characters, whitespace-collapsed and capped.
 */
import { bag, type Raw } from "./jsonapi";

export type LeadOrigin = { source: string | null; detail: string | null };

export const NO_ORIGIN: LeadOrigin = { source: null, detail: null };
export const ORIGIN_DETAIL_CAP = 200;

/** RPB's field ids: hints only, for an entry that has no name of its own. */
export const HINT_IDS = {
  how: ["589386", "878263", "690013"],
  referredBy: ["491217"],
  specify: ["491218"],
} as const;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clean(value: unknown, max = ORIGIN_DETAIL_CAP): string | null {
  let v = value;
  if (Array.isArray(v)) v = v.filter((x) => typeof x === "string").join(", ");
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, max).trim() : null;
}

type Kind = "how" | "referredBy" | "specify";

function kindOfName(name: string): Kind | null {
  const n = name.trim().toLowerCase();
  if (n.includes("how did you hear")) return "how";
  if (n.includes("referred by")) return "referredBy";
  if (n.includes("specify source")) return "specify";
  return null;
}

function kindOfId(id: string): Kind | null {
  for (const k of ["how", "referredBy", "specify"] as const) if ((HINT_IDS[k] as readonly string[]).includes(id)) return k;
  return null;
}

type Answers = { how: string | null; referredBy: string | null; specify: string | null };

/**
 * The three answers off a prospect. `fieldNames` (custom field id -> name, read once per run) lets a
 * value keyed only by id be matched by name; without it the entry's own name, then the id hints, decide.
 */
export function readOriginAnswers(rec: Raw, fieldNames?: ReadonlyMap<string, string>): Answers {
  const out: Answers = { how: null, referredBy: null, specify: null };
  const put = (kind: Kind | null, value: unknown) => {
    if (!kind || out[kind]) return;
    out[kind] = clean(value);
  };
  const attrs = bag(rec);

  const cfv = attrs.custom_field_values ?? rec.custom_field_values;
  if (isRaw(cfv)) {
    for (const [id, entry] of Object.entries(cfv)) {
      const value = isRaw(entry) ? (entry.formatted_value ?? entry.value) : entry;
      const own = isRaw(entry) ? [entry.name, entry.label, entry.custom_field_name].find((x) => typeof x === "string") : undefined;
      const named = typeof own === "string" ? own : fieldNames?.get(id) ?? (isRaw(entry) && entry.custom_field_id !== undefined ? fieldNames?.get(String(entry.custom_field_id)) : undefined);
      put((named ? kindOfName(named) : null) ?? kindOfId(id), value);
    }
  } else if (Array.isArray(cfv)) {
    for (const entry of cfv) {
      if (!isRaw(entry)) continue;
      const id = entry.custom_field_id ?? entry.id;
      const idStr = typeof id === "string" || typeof id === "number" ? String(id) : "";
      const own = [entry.name, entry.label, entry.custom_field_name].find((x) => typeof x === "string");
      const named = typeof own === "string" ? own : fieldNames?.get(idStr);
      put((named ? kindOfName(named) : null) ?? (idStr ? kindOfId(idStr) : null), entry.formatted_value ?? entry.value);
    }
  }

  // The `custom_fields` array / map shape hired-sync-normalize reads: [{ name, value }] or { name: value }.
  const cf = attrs.custom_fields ?? rec.custom_fields;
  if (Array.isArray(cf)) {
    for (const entry of cf) {
      if (!isRaw(entry)) continue;
      const label = [entry.name, entry.label, entry.custom_field_name, entry.key].find((x) => typeof x === "string");
      if (typeof label === "string") put(kindOfName(label), entry.formatted_value ?? entry.value);
    }
  } else if (isRaw(cf)) {
    for (const [k, v] of Object.entries(cf)) put(kindOfName(k), isRaw(v) ? (v.formatted_value ?? v.value) : v);
  }
  return out;
}

/** Tag names on a prospect: relationship refs resolved through `tagNames` (id -> name), or inline names. */
export function prospectTagNames(rec: Raw, tagNames?: ReadonlyMap<string, string>): string[] {
  const names: string[] = [];
  const add = (v: unknown) => {
    const s = clean(v, 120);
    if (s) names.push(s);
  };
  const resolve = (v: unknown) => {
    if (typeof v === "string") add(tagNames?.get(v) ?? v);
    else if (typeof v === "number") add(tagNames?.get(String(v)));
    else if (isRaw(v)) {
      const id = v.id;
      const idStr = typeof id === "string" || typeof id === "number" ? String(id) : null;
      const inline = bag(v).name ?? v.name;
      if (typeof inline === "string") add(inline);
      else if (idStr) add(tagNames?.get(idStr));
    }
  };
  const attrs = bag(rec);
  for (const src of [attrs.tags, rec.tags, attrs.tag_names]) if (Array.isArray(src)) src.forEach(resolve);
  for (const src of [attrs.tag_ids, rec.tag_ids]) {
    if (Array.isArray(src)) for (const id of src) if (typeof id === "string" || typeof id === "number") add(tagNames?.get(String(id)));
  }
  const rel = isRaw(rec.relationships) && isRaw(rec.relationships.tags) ? rec.relationships.tags.data : null;
  if (Array.isArray(rel)) rel.forEach(resolve);
  return [...new Set(names)];
}

const IG = /\b(ig|insta|instagram)\b/i;
const REFERRALISH = /refer|friend|recommend/i;
const EVENT_YEAR_TAG = /\b(?:19|20)\d{2}\b/;

function fromTags(tags: readonly string[]): LeadOrigin | null {
  const plain = tags.filter((t) => !/^source\s*:/i.test(t));
  const ugw = plain.find((t) => /\bugw\b/i.test(t));
  if (ugw) return { source: "UGW", detail: clean(ugw) };
  const ev = plain.find((t) => EVENT_YEAR_TAG.test(t));
  if (ev) return { source: "Event", detail: clean(ev) };
  if (plain.some((t) => /webinar/i.test(t))) return { source: "Event", detail: "Webinar" };
  return null;
}

function fromHow(how: string, a: Answers): LeadOrigin {
  const picks = how.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const has = (re: RegExp) => picks.some((p) => re.test(p));
  const spec = a.specify;
  const by = a.referredBy;
  const o = (source: string, detail: string | null): LeadOrigin => ({ source, detail: clean(detail) });

  if (has(/^referral\b/)) return o("Referral", by ?? spec);
  if (has(/^current client\b/)) return o("Referral", by ? `Current client: ${by}` : "Current client");
  if (has(/^event\b/)) return o("Event", spec ?? by);
  if (has(/^social media\b/)) return o(spec && IG.test(spec) ? "Instagram" : "Social media", spec);
  if (has(/^search engine\b/)) return o("Search engine", spec);
  if (has(/^website\b/)) return o("Website", spec);
  // Other, or anything else the picklist gains later.
  if (spec && IG.test(spec)) return o("Instagram", spec);
  if (by) return o("Referral", by);
  return o("Other", spec);
}

/** The origin of a Lawmatics prospect. See the file header for the rules and their order. */
export function leadOriginFromProspect(
  rec: Raw,
  tagNames?: ReadonlyMap<string, string>,
  fieldNames?: ReadonlyMap<string, string>,
): LeadOrigin {
  const tags = prospectTagNames(rec, tagNames);
  const fromTag = fromTags(tags);
  if (fromTag) return fromTag;

  const a = readOriginAnswers(rec, fieldNames);
  if (a.how) return fromHow(a.how, a);
  if (a.referredBy) return { source: "Referral", detail: a.referredBy };
  if (a.specify) {
    if (IG.test(a.specify)) return { source: "Instagram", detail: a.specify };
    if (REFERRALISH.test(a.specify)) return { source: "Referral", detail: a.specify };
    return { source: "Other", detail: a.specify };
  }
  if (tags.some((t) => /^source\s*:\s*direct$/i.test(t))) return { source: "Inbound", detail: "Direct" };
  return { ...NO_ORIGIN };
}

/** "Source (detail)", "Source" or null: the free-text form crm_matter.referral_source stores. */
export function originAsMatterSource(o: LeadOrigin): string | null {
  if (!o.source) return null;
  return o.detail ? `${o.source} (${o.detail})`.slice(0, 250) : o.source;
}
