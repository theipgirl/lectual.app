/**
 * JSON:API envelope readers for the Lawmatics REST API.
 *
 * Lawmatics list responses are JSON:API shaped — `{ data, meta, links }` — but
 * not uniformly so: a single-record fetch can come back flat, `attributes` is
 * sometimes absent, and the fields that matter most for an import (stage,
 * practice area, the prospect's contact) are NOT in `attributes` at all. They
 * are `relationships` refs that only resolve through the sibling `included`
 * array. Every reader below therefore tolerates both the flat and the enveloped
 * shape and never assumes a key exists.
 *
 * Pure module: no I/O, no `server-only`. Unit-tested against fixtures.
 */

export type Raw = Record<string, unknown>;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The record list out of a list response. Tolerates a bare array. */
export function records(payload: unknown): Raw[] {
  if (Array.isArray(payload)) return payload.filter(isRaw);
  if (isRaw(payload) && Array.isArray(payload.data)) {
    return (payload.data as unknown[]).filter(isRaw);
  }
  if (isRaw(payload) && isRaw(payload.data)) return [payload.data];
  return [];
}

/** The `attributes` bag if present, else the record itself (flat shape). */
export function bag(rec: Raw): Raw {
  return isRaw(rec.attributes) ? rec.attributes : rec;
}

/**
 * First non-empty string/number value across `attributes` then the record
 * itself, trying each key in order. Numbers are stringified — Lawmatics ids
 * and some phone fields come back numeric.
 */
export function field(rec: Raw, ...keys: string[]): string | null {
  const attrs = bag(rec);
  for (const key of keys) {
    for (const src of attrs === rec ? [rec] : [attrs, rec]) {
      const v = src[key];
      if (typeof v === "string" && v.trim().length > 0) return v;
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

/** A record's id as a string. Returns null when there isn't a usable one. */
export function idOf(rec: Raw): string | null {
  for (const v of [rec.id, bag(rec).id]) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Index the `included` array as `"type:id" -> record`, so a `relationships`
 * ref can be resolved to the full sideloaded record (not just its name — the
 * importer needs the contact's email and phone, which live in its attributes).
 */
export function includedIndex(payload: unknown): Map<string, Raw> {
  const index = new Map<string, Raw>();
  if (!isRaw(payload) || !Array.isArray(payload.included)) return index;
  for (const entry of payload.included as unknown[]) {
    if (!isRaw(entry)) continue;
    const type = entry.type;
    const id = idOf(entry);
    if (typeof type === "string" && id) index.set(`${type}:${id}`, entry);
  }
  return index;
}

/** Resolve `rec.relationships[key]` (to-one) through an `included` index. */
export function related(
  rec: Raw,
  key: string,
  index: Map<string, Raw>,
): Raw | null {
  if (!isRaw(rec.relationships)) return null;
  const rel = rec.relationships[key];
  if (!isRaw(rel)) return null;
  const data = rel.data;
  if (!isRaw(data)) return null;
  const type = data.type;
  const id = idOf(data);
  if (typeof type !== "string" || !id) return null;
  return index.get(`${type}:${id}`) ?? null;
}

/** The id a to-one relationship points at, even when it isn't sideloaded. */
export function relatedId(rec: Raw, key: string): string | null {
  if (!isRaw(rec.relationships)) return null;
  const rel = rec.relationships[key];
  if (!isRaw(rel)) return null;
  const data = rel.data;
  if (!isRaw(data)) return null;
  return idOf(data);
}

/** `rec.<key>.name` for the nested-object shape (e.g. `prospect.stage.name`). */
export function nestedName(rec: Raw, key: string): string | null {
  const attrs = bag(rec);
  const v = attrs[key] ?? rec[key];
  if (typeof v === "string" && v.trim().length > 0) return v;
  if (isRaw(v)) return field(v, "name", "title", "label");
  return null;
}

/**
 * Display name of a to-one relationship, however the server chose to express
 * it: nested object, flat `<key>_name` attribute, or a sideloaded `included`
 * record. Checked in that order.
 */
export function relatedName(
  rec: Raw,
  key: string,
  index: Map<string, Raw>,
): string | null {
  const nested = nestedName(rec, key);
  if (nested) return nested;
  const flat = field(rec, `${key}_name`);
  if (flat) return flat;
  const full = related(rec, key, index);
  return full ? field(full, "name", "title", "label") : null;
}

/**
 * Total page count from `meta`, when the server reports one. Lawmatics has
 * used several spellings across endpoints, so try them all; null means "the
 * server didn't say" and the pager falls back to its short-page heuristic.
 */
export function metaTotalPages(payload: unknown): number | null {
  if (!isRaw(payload) || !isRaw(payload.meta)) return null;
  const meta = payload.meta;
  for (const key of ["total_pages", "page_count", "totalPages", "last_page"]) {
    const v = meta[key];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number.parseInt(v, 10);
  }
  return null;
}
