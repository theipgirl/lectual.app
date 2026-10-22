/**
 * The firm's "LOE fields" setting (Sprint 19, stretch): which of its own Lawmatics custom
 * fields receive the engagement letter's figures when a proposal is marked paid, so a
 * Lawmatics automation can build the e-sign draft from them.
 *
 * OFF BY DEFAULT. A firm with no key, a malformed key or `enabled: false` gets no request.
 * With no migration allowed, the setting lives in `client_proposal_setting.pricing` under
 * `lawmatics_loe_fields`, beside the package list: `{ enabled, map: { <name>: <field id> } }`.
 * `withPackages` and `parseSettingsPricing` spread the stored object, so saving packages or
 * the proposal settings keeps the key; `withLoeFields` is the one thing that writes it.
 *
 * Pure and client-safe.
 */

import { LOE_FIELD_NAMES, type LoeFieldName } from "./loe-adapter";

export const LOE_FIELDS_KEY = "lawmatics_loe_fields";

export type LoeFieldsConfig = { enabled: boolean; map: Partial<Record<LoeFieldName, string>> };

/** A Lawmatics custom-field id as it may be stored: short, no spaces or punctuation that could be mistaken for a path. */
const FIELD_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function isFieldId(value: unknown): value is string {
  return typeof value === "string" && FIELD_ID.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The stored setting, or "off with nothing mapped". Total: a malformed value is off, never a throw. */
export function readLoeFieldsConfig(pricing: unknown): LoeFieldsConfig {
  const raw = isObject(pricing) ? pricing[LOE_FIELDS_KEY] : null;
  if (!isObject(raw)) return { enabled: false, map: {} };
  const map: Partial<Record<LoeFieldName, string>> = {};
  const given = isObject(raw.map) ? raw.map : {};
  for (const name of LOE_FIELD_NAMES) {
    const id = given[name];
    const asText = typeof id === "number" && Number.isInteger(id) ? String(id) : id;
    if (isFieldId(asText)) map[name] = asText;
  }
  return { enabled: raw.enabled === true, map };
}

/** `pricing` with the setting stored; every other key is kept. */
export function withLoeFields(pricing: Record<string, unknown>, config: LoeFieldsConfig): Record<string, unknown> {
  return { ...pricing, [LOE_FIELDS_KEY]: { enabled: config.enabled === true, map: { ...config.map } } };
}

export type ParsedLoeFields = { ok: true; value: LoeFieldsConfig } | { ok: false; error: string };

/** The settings form: `enabled` and `map.<name>` (a field id, or blank for "not matched"). */
export function parseLoeFieldsForm(form: FormData): ParsedLoeFields {
  const map: Partial<Record<LoeFieldName, string>> = {};
  for (const name of LOE_FIELD_NAMES) {
    const raw = form.get(`map.${name}`);
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) continue;
    if (!isFieldId(id)) return { ok: false, error: `That isn't a Lawmatics field for ${name}. Pick one from the list.` };
    map[name] = id;
  }
  return { ok: true, value: { enabled: form.get("enabled") === "on", map } };
}

export type FieldWrites = {
  writes: Array<{ id: string; value: string }>;
  /** Names with no field matched, in display order. */
  unmapped: LoeFieldName[];
};

/** The mapped names and the text each receives. A name with no mapping (or no text) is skipped and named. */
export function fieldWrites(config: LoeFieldsConfig, values: Record<LoeFieldName, string>): FieldWrites {
  const writes: FieldWrites["writes"] = [];
  const unmapped: LoeFieldName[] = [];
  for (const name of LOE_FIELD_NAMES) {
    const id = config.map[name];
    if (!id) unmapped.push(name);
    else writes.push({ id, value: values[name] });
  }
  return { writes, unmapped };
}
