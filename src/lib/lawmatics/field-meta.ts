import type { LawmaticsClient } from "./client";
import { bag, idOf, type Raw } from "./jsonapi";

/**
 * Lawmatics custom-field metadata: each field's name, type and (for a picklist) its options as id -> label, plus the one
 * pure resolver that turns a stored value into text a person can read. A picklist value comes back from Lawmatics as an
 * option ID (a 6-digit number was printed as "referral source" in a consult brief). It must never be printed.
 *
 * The real `/custom_fields` shape is NOT verified against a live account: this reads every likely spelling and, when it
 * can't make sense of a value, says "not recorded" rather than print a number.
 *
 * Pure apart from `readFieldMeta`'s single `listAll`. Read-only. Nothing here logs: values are client content.
 */

export type FieldMeta = {
  id: string;
  name: string;
  /** Lower-cased type word as Lawmatics gave it ("select", "multi_select", "text"...); "" when none was found. */
  type: string;
  /** Option id -> label. Empty for a field with no options. */
  options: ReadonlyMap<string, string>;
};

export type FieldMetaIndex = { byId: ReadonlyMap<string, FieldMeta>; byName: ReadonlyMap<string, FieldMeta> };

/** `ok`: the list was read (and understood). `failed`: it was not, so no label can be looked up. */
export type FieldMetaRead = { state: "ok"; index: FieldMetaIndex } | { state: "failed" };

/** What a value is looked up against. `undefined` (nothing passed) is the same as a failed read: nothing is looked up. */
export type LabelLookup = FieldMetaRead | undefined;

export const NOT_RECORDED_TEXT = "not recorded";

const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

const OPTION_KEYS = ["options", "picklist_options", "values", "choices", "option_values", "picklist_values", "select_options"];
const TYPE_KEYS = ["field_type", "data_type", "input_type", "kind", "type"];
const ID_KEYS = ["id", "value", "key"];
const LABEL_KEYS = ["name", "label", "title", "value", "display_value", "text"];

/** One option entry as [id, label], or null. `{ id, name }`, `{ value, label }`, `{ key, name }`; a bare string has no id and is skipped. */
function optionOf(entry: unknown): [string, string] | null {
  if (!isRaw(entry)) return null;
  const b = bag(entry);
  let id: string | null = null;
  for (const k of ID_KEYS) {
    id = str(b[k] ?? entry[k]);
    if (id) break;
  }
  let label: string | null = null;
  for (const k of LABEL_KEYS) {
    const v = b[k] ?? entry[k];
    const s = typeof v === "string" && v.trim() ? v.trim() : null;
    if (s && s !== id) {
      label = s;
      break;
    }
  }
  return id && label ? [id, label] : null;
}

function optionsOf(rec: Raw, included: ReadonlyMap<string, Raw> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const b = bag(rec);
  for (const key of OPTION_KEYS) {
    const v = b[key] ?? rec[key];
    if (Array.isArray(v)) {
      for (const e of v) {
        const o = optionOf(e);
        if (o && !out.has(o[0])) out.set(o[0], o[1]);
      }
    } else if (isRaw(v)) {
      // `{ "<id>": "<label>" }`
      for (const [id, label] of Object.entries(v)) {
        const l = typeof label === "string" && label.trim() ? label.trim() : null;
        if (l && /^\d+$/.test(id) && !out.has(id)) out.set(id, l);
      }
    }
  }
  // Sideloaded options (`relationships.<options|picklist_options|...>.data[]` resolved through `included`).
  const rels = isRaw(rec.relationships) ? rec.relationships : null;
  if (rels && included) {
    for (const key of [...OPTION_KEYS, "custom_field_options"]) {
      const rel = rels[key];
      const data = isRaw(rel) ? rel.data : null;
      if (!Array.isArray(data)) continue;
      for (const ref of data) {
        if (!isRaw(ref)) continue;
        const rid = idOf(ref);
        const type = typeof ref.type === "string" ? ref.type : "";
        const inc = rid ? included.get(`${type}:${rid}`) : undefined;
        const o = inc ? optionOf(inc) ?? (rid && str(bag(inc).name ?? bag(inc).label) ? ([rid, str(bag(inc).name ?? bag(inc).label) as string] as [string, string]) : null) : null;
        if (o && !out.has(o[0])) out.set(o[0], o[1]);
      }
    }
  }
  return out;
}

function typeOf(rec: Raw): string {
  const b = bag(rec);
  for (const k of TYPE_KEYS) {
    const v = typeof b[k] === "string" ? (b[k] as string) : null;
    if (v && v.trim()) return v.trim().toLowerCase();
  }
  return "";
}

/** The `/custom_fields` records as an index by id and by (lower-cased) name. Never throws. */
export function parseFieldMeta(records: readonly Raw[], included?: ReadonlyMap<string, Raw>): FieldMetaIndex {
  const byId = new Map<string, FieldMeta>();
  const byName = new Map<string, FieldMeta>();
  for (const rec of records) {
    const id = idOf(rec);
    const b = bag(rec);
    const name = str(b.name ?? rec.name ?? b.title ?? rec.title ?? b.label ?? rec.label);
    if (!id && !name) continue;
    const meta: FieldMeta = { id: id ?? "", name: name ?? "", type: typeOf(rec), options: optionsOf(rec, included) };
    if (id && !byId.has(id)) byId.set(id, meta);
    if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), meta);
  }
  return { byId, byName };
}

/**
 * The firm's `/custom_fields`, read ONCE per client (the callers keep one client for the run). A read that threw or came back in a
 * shape that isn't a list is `failed`. Never throws, never logs.
 */
const reads = new WeakMap<LawmaticsClient, Promise<FieldMetaRead>>();

export function readFieldMeta(client: LawmaticsClient): Promise<FieldMetaRead> {
  const have = reads.get(client);
  if (have) return have;
  const read = (async (): Promise<FieldMetaRead> => {
    try {
      const list = await client.listAll("/custom_fields", { maxRecords: 1000 });
      if (list.unrecognisedShape) return { state: "failed" };
      return { state: "ok", index: parseFieldMeta(list.records, list.included) };
    } catch {
      return { state: "failed" };
    }
  })();
  reads.set(client, read);
  return read;
}

// ── the resolver ─────────────────────────────────────────────────────────────

/** Digits only, or a comma list of them ("123456", "123, 456"): what an option id (or several) looks like. */
const ID_LIST = /^\d+(?:\s*,\s*\d+)*$/;
const idTokens = (text: string): string[] | null => (ID_LIST.test(text.trim()) ? text.split(",").map((t) => t.trim()) : null);
/** A bare number of 3 or more digits: too long to be a small count, so treated as an id. */
const hasLongNumber = (tokens: readonly string[]): boolean => tokens.some((t) => t.length >= 3);

/** select, picklist, dropdown, radio, multi-select (any spelling). */
export const isSelectType = (type: string): boolean => /select|pick|drop\s*-?_?down|radio|choice|multi/i.test(type);

export type ValueInput = {
  /** `formatted_value` as Lawmatics gave it, if any. */
  formatted: string | null;
  /** The stored value, as text (an array already comma-joined). */
  raw: string | null;
  /** The field this value belongs to: by id, else by name. Undefined = not found in a successful read, or no read. */
  meta: FieldMeta | undefined;
  /** Whether the field list was read. `failed` (or none) = nothing can be looked up. */
  labels: "ok" | "failed";
};

/**
 * One Lawmatics value as text, or `null` for "not recorded". In order:
 *  1. `formatted_value` when present and not itself a bare id;
 *  2. else the option label(s) of a select-type field (comma-joined for several);
 *  3. else, a bare number of 3+ digits on a select field (or one with options) is "not recorded";
 *  4. otherwise the value.
 * A failed field-list read prints no id: a bare 3+ digit value reads "not recorded" because nothing can say it isn't an option id.
 * A field the (successful) list doesn't name does the same, the safe side of the same doubt.
 */
export function resolveValue(input: ValueInput): string | null {
  const formatted = input.formatted?.trim() || null;
  const raw = input.raw?.trim() || null;
  if (formatted && !ID_LIST.test(formatted)) return formatted;
  const value = formatted ?? raw;
  if (!value) return null;
  const tokens = idTokens(value);
  if (!tokens) return value;
  const { meta } = input;
  const select = !!meta && (isSelectType(meta.type) || meta.options.size > 0);
  if (select && meta) {
    const labels = tokens.map((t) => meta.options.get(t)).filter((l): l is string => !!l);
    if (labels.length > 0) return labels.join(", ");
    return hasLongNumber(tokens) ? null : value;
  }
  if (input.labels === "ok" && meta) return value; // a field the firm's list says is text or a number: its value is its value
  // No field to look at (the list failed, or does not name it): a long number may be an option id.
  return hasLongNumber(tokens) ? null : value;
}

/** The field a value belongs to: by id first, then by (case-insensitive) name. */
export function findField(lookup: LabelLookup, id: string | null | undefined, name: string | null | undefined): FieldMeta | undefined {
  if (!lookup || lookup.state !== "ok") return undefined;
  const byId = id ? lookup.index.byId.get(String(id)) : undefined;
  if (byId) return byId;
  return name ? lookup.index.byName.get(name.trim().toLowerCase()) : undefined;
}

/**
 * A value Lectual stores that came from Lawmatics and may still be a bare option id (a lead's referral detail, say). A value, or a
 * comma-separated part of one, that is a number of 3+ digits reads "not recorded" and the number is never printed. Words pass unchanged;
 * a value with no such part is returned as it was.
 */
export function withoutBareIds(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const parts = text.split(",").map((p) => p.trim());
  if (!parts.some((p) => /^\d{3,}$/.test(p))) return text;
  return parts.filter((p) => p !== "").map((p) => (/^\d{3,}$/.test(p) ? NOT_RECORDED_TEXT : p)).join(", ");
}
