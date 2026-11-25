import type { LawmaticsClient } from "@/lib/lawmatics/client";
import { NOT_RECORDED_TEXT, findField, readFieldMeta, resolveValue, type LabelLookup } from "@/lib/lawmatics/field-meta";
import { bag, idOf, includedIndex, records, related, type Raw } from "@/lib/lawmatics/jsonapi";

/**
 * The Lawmatics prospect's intake answers, for the consult brief.
 *
 * PORTED from lawmatics-mcp `src/consult-brief/facts.ts` (see PORTED_FROM.md): the tolerant, case-insensitive label
 * patterns that map a firm's own custom-field labels onto facts, and the "all fields first, then a plain read" fetch.
 * Changes: it takes the per-firm read-only client (`get` only; the token is the firm's own), reports three states
 * instead of throwing, never logs, adds the facts the brief needs (competitors, goals, consult fee paid), and maps
 * to plain strings. A label no pattern matches reads "not recorded"; the client's words are never altered here except
 * to strip tags and control characters.
 *
 * Pure apart from the one `get`. Nothing here logs: names, marks and answers are client content.
 */

export type IntakePair = { label: string; value: string };

export type IntakeFactKey =
  | "useInCommerce"
  | "consultFeePaid"
  | "competitors"
  | "goals"
  | "referralSource"
  | "website"
  | "practiceArea"
  | "productsServices"
  | "company"
  | "mark"
  | "inquiry";

/**
 * Label patterns, tried IN ORDER; a label goes to the first fact it matches. Order matters: "Is your mark in use in
 * commerce?" mentions the mark but is the use-in-commerce answer, and "How did you hear about our services?" is the
 * referral source, not the products/services answer.
 */
export const INTAKE_PATTERNS: ReadonlyArray<[IntakeFactKey, RegExp]> = [
  ["consultFeePaid", /\b(consult(ation)? fee|fee paid|paid (the )?(consult|fee)|payment (received|made))\b/i],
  ["useInCommerce", /\b(in commerce|in use|currently (using|use|selling|operating)|already (using|selling|launched)|first use|date of (first )?use|been using|intent to use|planning to (use|launch))\b/i],
  ["referralSource", /\b(hear about|heard about|referr(al|ed)|how did you find|lead source|source)\b/i],
  ["competitors", /\b(competitors?|similar (brands?|businesses|marks?|names?)|compet(e|ing) with)\b/i],
  ["goals", /\b(goals?|hope to (achieve|accomplish)|what (do )?you (want|hope)|looking to (achieve|accomplish)|objectives?)\b/i],
  ["website", /\b(website|web site|url|domain|social media|instagram|online presence)\b/i],
  ["practiceArea", /\b(practice area|area of law|type of (matter|case|legal (service|matter))|legal (need|service)s?|matter type|service (needed|type|of interest))\b/i],
  ["productsServices", /\b(products?|services?|goods|what do(es)? (you|your business) (sell|offer|do))\b/i],
  ["company", /\b(company( name)?|entity( name)?|llc|corporation|business entity|legal name of (your )?business)\b/i],
  ["mark", /\b(mark|brand( name)?|trademark|name (you )?(want|wish|would like) to (protect|register)|logo|slogan|tagline)\b/i],
  ["inquiry", /\b(describe|description|inquiry|how can we help|tell us|what (do|can) (you|we)|reason for|details|about your (matter|business|brand|situation)|question)\b/i],
];

export function mapIntakeLabel(label: string): IntakeFactKey | null {
  for (const [key, re] of INTAKE_PATTERNS) if (re.test(label)) return key;
  return null;
}

/** First non-empty value per fact, from the label patterns above. */
export function mapIntake(pairs: readonly IntakePair[]): Partial<Record<IntakeFactKey, string>> {
  const out: Partial<Record<IntakeFactKey, string>> = {};
  for (const p of pairs) {
    const key = mapIntakeLabel(p.label);
    // A value that could not be put into words ("not recorded", an option id that was never printed) never takes a fact's place.
    if (key && !out[key] && p.value.trim() && p.value.trim() !== NOT_RECORDED_TEXT) out[key] = p.value.trim();
  }
  return out;
}

export const MAX_INTAKE_PAIRS = 40;
export const MAX_LABEL_CHARS = 120;
export const MAX_VALUE_CHARS = 600;

/** Tags and angle brackets removed, control characters (newlines included) collapsed to spaces, whitespace squeezed, then capped. */
export function sanitizeText(s: string, max: number): string {
  const cleaned = s
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

export function sanitizeIntake(pairs: readonly IntakePair[]): IntakePair[] {
  const out: IntakePair[] = [];
  for (const p of pairs) {
    const label = sanitizeText(p.label, MAX_LABEL_CHARS);
    const value = sanitizeText(p.value, MAX_VALUE_CHARS);
    if (!label || !value) continue;
    out.push({ label, value });
    if (out.length >= MAX_INTAKE_PAIRS) break;
  }
  return out;
}

// ── reading the payload ──────────────────────────────────────────────────────

const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const parts = v.map(scalarText).filter((x): x is string => !!x);
    return parts.length ? parts.join(", ") : null;
  }
  if (isRaw(v)) {
    // `{ id, name }`, `{ value, label }`: the readable part, never the id.
    for (const k of ["formatted_value", "name", "label", "value"]) {
      const inner = scalarText(v[k]);
      if (inner) return inner;
    }
  }
  return null;
}

const LABEL_KEYS = ["label", "name", "field_name", "custom_field_name", "title", "question"];
const RAW_VALUE_KEYS = ["value", "answer", "response", "data", "display_value"];

/**
 * One answer as a pair. The value goes through the ONE resolver (`resolveValue`): Lawmatics' own `formatted_value` when it is
 * words, else the option's label, else "not recorded" for a number that is probably an option id. Never an id.
 */
function valuePair(label: string, fieldId: string | null, formatted: string | null, raw: string | null, labels: LabelLookup): IntakePair | null {
  if (!formatted && !raw) return null;
  const value = resolveValue({ formatted, raw, meta: findField(labels, fieldId, label), labels: labels?.state === "ok" ? "ok" : "failed" });
  return { label, value: value ?? NOT_RECORDED_TEXT };
}

function pairFrom(entry: Raw, fieldNames: ReadonlyMap<string, string> | undefined, labels: LabelLookup, keyId?: string): IntakePair | null {
  const b = bag(entry);
  let label: string | null = null;
  for (const k of LABEL_KEYS) {
    const v = b[k] ?? entry[k];
    if (typeof v === "string" && v.trim()) {
      label = v.trim();
      break;
    }
    if (isRaw(v)) {
      const inner = [v.name, v.label].find((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (inner) {
        label = inner.trim();
        break;
      }
    }
  }
  const cf = b.custom_field ?? entry.custom_field;
  let fieldId: string | null = keyId ?? null;
  const idRaw = b.custom_field_id ?? entry.custom_field_id;
  if (typeof idRaw === "string" || typeof idRaw === "number") fieldId = String(idRaw);
  else if (isRaw(cf) && (typeof cf.id === "string" || typeof cf.id === "number")) fieldId = String(cf.id);
  if (!label && isRaw(cf)) label = [cf.name, cf.label].find((x): x is string => typeof x === "string" && x.trim().length > 0)?.trim() ?? null;
  if (!label && fieldNames && fieldId) label = fieldNames.get(fieldId) ?? null;
  const formatted = scalarText(b.formatted_value ?? entry.formatted_value);
  let raw: string | null = null;
  for (const k of RAW_VALUE_KEYS) {
    raw = scalarText(b[k] ?? entry[k]);
    if (raw) break;
  }
  return label ? valuePair(label, fieldId, formatted, raw, labels) : null;
}

/** Every intake (custom-field) label/value pair the response carries, whichever of the likely shapes it uses. */
export function customFieldPairs(payload: unknown, fieldNames?: ReadonlyMap<string, string>, labels?: LabelLookup): IntakePair[] {
  const rec = records(payload)[0];
  const out: IntakePair[] = [];
  if (rec) {
    const b = bag(rec);
    for (const key of ["custom_fields", "custom_field_values", "intake_fields", "intake"]) {
      const v = b[key] ?? rec[key];
      if (Array.isArray(v)) {
        for (const e of v) {
          if (!isRaw(e)) continue;
          const p = pairFrom(e, fieldNames, labels);
          if (p) out.push(p);
        }
      } else if (isRaw(v)) {
        for (const [k, raw] of Object.entries(v)) {
          if (isRaw(raw)) {
            const p = pairFrom({ ...raw, ...(raw.name || raw.label || raw.custom_field_name ? {} : { name: fieldNames?.get(k) ?? "" }) }, fieldNames, labels, /^\d+$/.test(k) ? k : undefined);
            if (p) out.push(p);
          } else {
            // A map keyed by the label itself, or by a custom field id the firm's field list names.
            const label = fieldNames?.get(k) ?? k;
            const p = label.trim() ? valuePair(label.trim(), /^\d+$/.test(k) ? k : null, null, scalarText(raw), labels) : null;
            if (p) out.push(p);
          }
        }
      }
    }
  }
  const index = includedIndex(payload);
  for (const [key, inc] of index) {
    if (/^custom_?field/i.test(key.split(":")[0] ?? "")) {
      const p = pairFrom(inc, fieldNames, labels);
      if (p) out.push(p);
    }
  }
  return out;
}

/** True when a value looks like an id keyed map the label lookup should name (so the caller reads /custom_fields only then). */
export function needsFieldNames(payload: unknown): boolean {
  const rec = records(payload)[0];
  if (!rec) return false;
  const b = bag(rec);
  const cfv = b.custom_field_values ?? rec.custom_field_values;
  if (isRaw(cfv)) return Object.entries(cfv).some(([k, v]) => /^\d+$/.test(k) && !(isRaw(v) && (v.name || v.label || v.custom_field_name)));
  if (Array.isArray(cfv)) return cfv.some((e) => isRaw(e) && !(e.name || e.label || e.custom_field_name) && (e.custom_field_id !== undefined));
  return false;
}

function nestedName(rec: Raw, key: string, index: Map<string, Raw>): string | null {
  const nested = bag(rec)[key] ?? rec[key];
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (isRaw(nested)) {
    const n = [bag(nested).name, nested.name, bag(nested).title].find((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (n) return n.trim();
  }
  const hit = related(rec, key, index);
  if (hit) {
    const n = [bag(hit).name, hit.name, bag(hit).title].find((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (n) return n.trim();
  }
  return null;
}

function strAttr(rec: Raw, ...keys: string[]): string | null {
  const b = bag(rec);
  for (const k of keys) {
    for (const src of [b, rec]) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

// ── the read ─────────────────────────────────────────────────────────────────

export type LawmaticsIntake = {
  practiceArea: string | null;
  inquiry: string | null;
  mark: string | null;
  productsServices: string | null;
  company: string | null;
  useInCommerce: string | null;
  competitors: string | null;
  goals: string | null;
  consultFeePaid: string | null;
  website: string | null;
  referralSource: string | null;
};

export type LawmaticsRead =
  | {
      state: "ok";
      intake: LawmaticsIntake;
      other: IntakePair[];
      submittedAt: string | null;
      contactEmail: string | null;
      /** `failed`: the field list (names, types, option labels) could not be read, so an answer that is only an option id reads "not recorded". */
      labels?: "ok" | "failed";
    }
  | { state: "not-linked" }
  | { state: "not-connected" }
  | { state: "unavailable" };

export type ProspectReader = {
  /** The firm's own read-only client, or null when the firm has no active connection. `unreadable` = the connection could not be opened. */
  client: () => Promise<LawmaticsClient | null | "unreadable">;
};

const FETCH_PARAMS = { include: "practice_area,stage,contact", fields: "all" };

/** The pairs plus every named fact, from a payload that has been checked to be the prospect asked for. */
export function summariseProspect(payload: unknown, fieldNames?: ReadonlyMap<string, string>, labels?: LabelLookup): Extract<LawmaticsRead, { state: "ok" }> {
  const rec = records(payload)[0];
  const index = includedIndex(payload);
  const pairs = sanitizeIntake(customFieldPairs(payload, fieldNames, labels));
  const mapped = mapIntake(pairs);
  const used = new Set<string>();
  for (const p of pairs) if (mapIntakeLabel(p.label)) used.add(`${p.label}\u0000${p.value}`);
  const contact = rec ? related(rec, "contact", index) : null;
  const contactEmail = contact ? (strAttr(contact, "email") ?? null) : null;
  const practiceArea = (rec ? nestedName(rec, "practice_area", index) : null) ?? mapped.practiceArea ?? null;
  return {
    state: "ok",
    intake: {
      practiceArea,
      inquiry: mapped.inquiry ?? null,
      mark: mapped.mark ?? null,
      productsServices: mapped.productsServices ?? null,
      company: mapped.company ?? null,
      useInCommerce: mapped.useInCommerce ?? null,
      competitors: mapped.competitors ?? null,
      goals: mapped.goals ?? null,
      consultFeePaid: mapped.consultFeePaid ?? null,
      website: mapped.website ?? null,
      referralSource: mapped.referralSource ?? null,
    },
    other: pairs.filter((p) => !used.has(`${p.label}\u0000${p.value}`)).slice(0, 15),
    submittedAt: rec ? strAttr(rec, "created_at") : null,
    contactEmail,
    labels: labels?.state === "ok" ? "ok" : "failed",
  };
}

/**
 * `GET /prospects/<id>` with every field and the includes; when that fails, once more plainly. The answer must name
 * the prospect asked for. States: not linked (the lead has no Lawmatics id), not connected, ok, couldn't load.
 * Never throws, never logs.
 */
export async function readLawmaticsIntake(reader: ProspectReader, lawmaticsId: string | null | undefined): Promise<LawmaticsRead> {
  const id = (lawmaticsId ?? "").trim();
  if (!id) return { state: "not-linked" };
  let client: LawmaticsClient | null | "unreadable";
  try {
    client = await reader.client();
  } catch {
    return { state: "unavailable" };
  }
  if (client === "unreadable") return { state: "unavailable" };
  if (!client) return { state: "not-connected" };
  const path = `/prospects/${encodeURIComponent(id)}`;
  const attempt = async (params?: Record<string, string>): Promise<unknown | null> => {
    try {
      const payload = await client.get(path, params);
      const rec = records(payload)[0];
      return rec && idOf(rec) === id ? payload : null;
    } catch {
      return null;
    }
  };
  const payload = (await attempt(FETCH_PARAMS)) ?? (await attempt());
  if (!payload) return { state: "unavailable" };
  // The firm's field list (names, types, option labels), read once per client and so once per run. A failed read is not "no fields".
  const labels = await readFieldMeta(client);
  let fieldNames: Map<string, string> | undefined;
  if (labels.state === "ok") {
    fieldNames = new Map();
    for (const [rid, m] of labels.index.byId) if (m.name) fieldNames.set(rid, m.name);
  }
  return summariseProspect(payload, fieldNames, labels);
}
