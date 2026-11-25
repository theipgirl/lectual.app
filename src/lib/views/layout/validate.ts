import { LABEL_MAX, LAYOUT_MAX_COLUMNS, LAYOUT_MIN_COLUMNS, VIEW_KEYS, WIDTH_MAX, WIDTH_MIN, type Layout, type LayoutColumn, type ViewKey } from "./types";

/**
 * The layout rules, the same as 0119's CHECKs, so a layout the database could not store is never drawn and a layout this app writes is
 * never refused for its shape. Pure.
 */

const BUILTIN_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const CF_KEY = /^cf:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Control characters (POSIX `[[:cntrl:]]`, C1 included) and the invisible direction marks the database refuses. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const INVISIBLE = /[​-‏‪-‮⁦-⁩]/;
const ALLOWED_KEYS = new Set(["key", "label", "hidden", "width"]);

export const isViewKey = (x: unknown): x is ViewKey => typeof x === "string" && (VIEW_KEYS as readonly string[]).includes(x);
export const isBuiltinKey = (x: unknown): x is string => typeof x === "string" && BUILTIN_KEY.test(x);
/** A firm column's key. The database accepts only lowercase hex, so a field id is lowercased before it is named (`cfKey`). */
export const isCfKey = (x: unknown): x is string => typeof x === "string" && CF_KEY.test(x);
export const isLayoutKey = (x: unknown): x is string => isBuiltinKey(x) || isCfKey(x);
/** `cf:<field id>`, lowercased as the database requires. */
export const cfKey = (fieldId: string): string => `cf:${fieldId.toLowerCase()}`;

const length = (s: string): number => Array.from(s).length;

/**
 * A label a person typed: trimmed, 1..60 characters, no control character (a tab is one) and no invisible direction mark. Interior spaces
 * stay as typed. `ok: false` carries why, so the caller can say it in a fixed sentence.
 */
export function cleanLabel(raw: unknown): { ok: true; label: string } | { ok: false; reason: "empty" | "too-long" | "characters" } {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (CONTROL.test(raw) || INVISIBLE.test(raw)) return { ok: false, reason: "characters" };
  const label = raw.trim();
  if (label === "") return { ok: false, reason: "empty" };
  if (length(label) > LABEL_MAX) return { ok: false, reason: "too-long" };
  return { ok: true, label };
}

/** A stored label as the database holds it: already trimmed, 1..60, clean. */
function validStoredLabel(x: unknown): x is string {
  if (typeof x !== "string") return false;
  const c = cleanLabel(x);
  return c.ok && c.label === x;
}

const validWidth = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= WIDTH_MIN && x <= WIDTH_MAX;

/** One stored column, or null when it is not exactly the shape the database accepts. A missing label or width reads as null. */
export function parseLayoutColumn(raw: unknown): LayoutColumn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !ALLOWED_KEYS.has(k))) return null;
  if (!isLayoutKey(r.key) || typeof r.hidden !== "boolean") return null;
  const label = r.label === undefined || r.label === null ? null : r.label;
  if (label !== null && !validStoredLabel(label)) return null;
  const width = r.width === undefined || r.width === null ? null : r.width;
  if (width !== null && !validWidth(width)) return null;
  return { key: r.key, label, hidden: r.hidden, width };
}

/**
 * A stored layout, or null when it is not valid: not an array, fewer than 1 or more than 80 columns, a bad column or a repeated key.
 * A caller treats null as UNREADABLE (it draws the standard layout and says so), never as an empty table.
 */
export function parseLayout(raw: unknown): Layout | null {
  if (!Array.isArray(raw) || raw.length < LAYOUT_MIN_COLUMNS || raw.length > LAYOUT_MAX_COLUMNS) return null;
  const out: Layout = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const c = parseLayoutColumn(item);
    if (!c || seen.has(c.key)) return null;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}
