import { labelKey } from "@/lib/review/sheet-columns";

/**
 * CO1: what the app may hold in a column's label and choices, mirrored from lectual 0115's CHECKs, and the cleaners its writes use.
 * Pure: no React, no server import, no database.
 *
 * The READ side accepts exactly what the CHECKs accept, so a column the database stored is never silently dropped:
 *   label    1..60 code points (`char_length` in UTF-8) and `label = btrim(label)`, where `btrim` with its default characters strips only
 *            U+0020 (a tab or a non-breaking space at the end is allowed by the database, so it is allowed here);
 *   options  for a choice: a JSON array of 1..30 strings, each 1..40 code points and equal to its `btrim`; any other kind: `[]`.
 * The read side does NOT re-judge that options differ ignoring case: the database judged it with `lower()`, which JavaScript's
 * `toLowerCase` can disagree with on rare characters, and a field it stored must still be drawn.
 *
 * The WRITE side cleans before it sends (`cleanLabel`, `cleanOption`, `cleanText`): control characters and Unicode space separators
 * become U+0020, runs collapse, and the ends are stripped. So everything the app sends passes the CHECKs.
 */

export { labelKey };

/** Postgres `btrim(x)` with its default characters: only U+0020, from both ends. */
export function pgBtrim(s: string): string {
  return s.replace(/^ +| +$/g, "");
}

/** Postgres `char_length` on UTF-8 text: code points, so an emoji is one and a surrogate pair is never split. */
export function pgCharLength(s: string): number {
  return [...s].length;
}

/** The first `n` code points (display cuts never land inside a surrogate pair). */
export function cutCodePoints(s: string, n: number): string {
  const cps = [...s];
  return cps.length <= n ? s : cps.slice(0, n).join("");
}

export const LABEL_MAX = 60;
export const OPTIONS_MAX = 30;
export const OPTION_MAX = 40;

/** `crm_custom_field_label_len` and `crm_custom_field_label_trimmed`. */
export function sqlLabelOk(label: unknown): label is string {
  if (typeof label !== "string") return false;
  const n = pgCharLength(label);
  return n >= 1 && n <= LABEL_MAX && label === pgBtrim(label);
}

/** One option as `crm_custom_field_options_valid` judges each element. */
export function sqlOptionOk(option: unknown): option is string {
  if (typeof option !== "string") return false;
  const n = pgCharLength(option);
  return n >= 1 && n <= OPTION_MAX && option === pgBtrim(option);
}

/** The options' shape: every rule of `crm_custom_field_options_valid` except "distinct ignoring case" (the read side's test). */
export function optionsShapeOk(kind: string, options: unknown): options is string[] {
  if (!Array.isArray(options)) return false;
  if (kind !== "choice") return options.length === 0;
  return options.length >= 1 && options.length <= OPTIONS_MAX && options.every(sqlOptionOk);
}

/** The whole of `crm_custom_field_options_valid`, distinctness by `toLowerCase` (the write side's test; the SQL uses `lower()`). */
export function sqlOptionsOk(kind: string, options: unknown): options is string[] {
  if (!optionsShapeOk(kind, options)) return false;
  return new Set(options.map((o) => o.toLowerCase())).size === options.length;
}

/**
 * Control characters (C0, DEL, C1) and the Unicode space separators, plus U+FEFF and the line and paragraph separators. A zero-width
 * space (U+200B) is a format character, not a space: it is kept, as the database keeps it.
 */
const SPACE_LIKE = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]", "g");

/** What every write sends: space-like characters become one U+0020, runs collapse, the ends go. */
export function cleanText(raw: string): string {
  return pgBtrim(raw.replace(SPACE_LIKE, " ").replace(/ {2,}/g, " "));
}

export const cleanLabel = cleanText;
export const cleanOption = cleanText;
