import { CUSTOM_KINDS, CUSTOM_SECTIONS, isFieldId, type CustomKind, type CustomSection } from "@/lib/review/sheet-columns";
import {
  CUSTOM_BAD_KIND,
  CUSTOM_BAD_SECTION,
  CUSTOM_CHOICE_BAD,
  CUSTOM_CHOICE_TOO_LONG,
  CUSTOM_CHOICES_COUNT,
  CUSTOM_DATE_BAD,
  CUSTOM_LABEL_EMPTY,
  CUSTOM_LABEL_TOO_LONG,
  CUSTOM_MONEY_BAD,
  CUSTOM_MONEY_TOO_BIG,
  CUSTOM_PERSON_NOT_MEMBER,
  CUSTOM_TEXT_TOO_LONG,
  choiceRepeated,
} from "@/lib/ui/words";
import { LABEL_MAX, OPTION_MAX, OPTIONS_MAX, cleanLabel, cleanOption, cleanText, pgCharLength } from "./text";

/**
 * What a person typed for a custom column or a custom value, parsed. Pure: no React, no server import, no database. Every refusal is a
 * fixed sentence from `words.ts`. The actions run these on the server; the editors run the same ones only to decide "unchanged".
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const TEXT_MAX = 500;
/** `crm_custom_value_cents_range`: 0 to 100,000,000,000 cents. */
export const CENTS_MAX = BigInt(100_000_000_000);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const str = (raw: unknown): string => (typeof raw === "string" ? raw : "");

/* ── A column ── */

export function parseLabelInput(raw: unknown): Parsed<string> {
  const label = cleanLabel(str(raw));
  if (label === "") return fail(CUSTOM_LABEL_EMPTY);
  if (pgCharLength(label) > LABEL_MAX) return fail(CUSTOM_LABEL_TOO_LONG);
  return { ok: true, value: label };
}

export function parseSectionInput(raw: unknown): Parsed<CustomSection> {
  return typeof raw === "string" && (CUSTOM_SECTIONS as readonly string[]).includes(raw) ? { ok: true, value: raw as CustomSection } : fail(CUSTOM_BAD_SECTION);
}

export function parseKindInput(raw: unknown): Parsed<CustomKind> {
  return typeof raw === "string" && (CUSTOM_KINDS as readonly string[]).includes(raw) ? { ok: true, value: raw as CustomKind } : fail(CUSTOM_BAD_KIND);
}

/**
 * A Choice column's choices, one per line (a browser posts textarea lines with CRLF). A line that equals one of the column's EXISTING
 * choices exactly is kept as it is (N3: a stored choice with a tab or a non-breaking space must not count as removed on every save);
 * every other line is cleaned with `cleanOption`. Blank lines are dropped. 1 to 30 choices, each 1 to 40 characters, no repeat ignoring
 * case.
 */
export function parseChoicesInput(raw: unknown, existing: readonly string[] = []): Parsed<string[]> {
  const keep = new Set(existing);
  const out: string[] = [];
  for (const line of str(raw).split(/\r?\n/)) {
    const value = keep.has(line) ? line : cleanOption(line);
    if (value.trim() === "") continue;
    out.push(value);
  }
  if (out.length < 1 || out.length > OPTIONS_MAX) return fail(CUSTOM_CHOICES_COUNT);
  for (const o of out) if (pgCharLength(o) > OPTION_MAX) return fail(CUSTOM_CHOICE_TOO_LONG);
  const seen = new Set<string>();
  for (const o of out) {
    const k = o.toLowerCase();
    if (seen.has(k)) return fail(choiceRepeated(o));
    seen.add(k);
  }
  return { ok: true, value: out };
}

/* ── A value. `null` means blank: the action deletes the record's own value (or writes nothing when there is none). ── */

export function parseTextValue(raw: unknown): Parsed<string | null> {
  const text = cleanText(str(raw));
  if (text === "") return { ok: true, value: null };
  if (pgCharLength(text) > TEXT_MAX) return fail(CUSTOM_TEXT_TOO_LONG);
  return { ok: true, value: text };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Exactly YYYY-MM-DD, year 0001 to 9999, a real day of the Gregorian calendar. */
export function parseDateValue(raw: unknown): Parsed<string | null> {
  const s = str(raw).trim();
  if (s === "") return { ok: true, value: null };
  const m = DATE.exec(s);
  if (!m) return fail(CUSTOM_DATE_BAD);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return fail(CUSTOM_DATE_BAD);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > days) return fail(CUSTOM_DATE_BAD);
  return { ok: true, value: s };
}

/** An optional "$", digits plain or grouped in threes with commas, then an optional "." and 1 or 2 digits. */
const MONEY = /^\$?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * An amount in whole cents. Decided on the digit string with BigInt, never through a float, so "99999999999999999999" is too big and
 * never rounds into range.
 */
export function parseMoneyInput(raw: unknown): Parsed<number | null> {
  const s = str(raw).trim();
  if (s === "") return { ok: true, value: null };
  const m = MONEY.exec(s);
  if (!m) return fail(CUSTOM_MONEY_BAD);
  const cents = BigInt(m[1].replace(/,/g, "")) * BigInt(100) + BigInt((m[2] ?? "").padEnd(2, "0"));
  if (cents > CENTS_MAX) return fail(CUSTOM_MONEY_TOO_BIG);
  return { ok: true, value: Number(cents) };
}

/** Whole cents as the money editor shows them: "1250.00". */
export function centsToInput(cents: number): string {
  const c = BigInt(Math.trunc(cents));
  const whole = c / BigInt(100);
  const frac = (c % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

/** N2: one of the column's CURRENT choices, matched exactly (trimming only decides "blank"). */
export function parseChoiceValue(raw: unknown, options: readonly string[]): Parsed<string | null> {
  const s = str(raw);
  if (s.trim() === "") return { ok: true, value: null };
  return options.includes(s) ? { ok: true, value: s } : fail(CUSTOM_CHOICE_BAD);
}

/** A user id; whether it is a member of the firm is the action's check against the directory. */
export function parsePersonValue(raw: unknown): Parsed<string | null> {
  const s = str(raw).trim();
  if (s === "") return { ok: true, value: null };
  return isFieldId(s) ? { ok: true, value: s.toLowerCase() } : fail(CUSTOM_PERSON_NOT_MEMBER);
}

export type CustomInputValue = string | number | null;

export function parseValueInput(kind: CustomKind, raw: unknown, options: readonly string[]): Parsed<CustomInputValue> {
  switch (kind) {
    case "text":
      return parseTextValue(raw);
    case "date":
      return parseDateValue(raw);
    case "money":
      return parseMoneyInput(raw);
    case "choice":
      return parseChoiceValue(raw, options);
    case "person":
      return parsePersonValue(raw);
  }
}

/** The value in the editors' own form (text as cleaned, a date, money "1250.00", a choice, a user id), or null for blank. */
export function editorForm(kind: CustomKind, raw: string, options: readonly string[]): string | null | undefined {
  const p = parseValueInput(kind, raw, options);
  if (!p.ok) return undefined;
  if (p.value === null) return null;
  return kind === "money" ? centsToInput(p.value as number) : String(p.value);
}

/**
 * "An unchanged editor posts nothing": what was typed or picked, parsed by the kind's parser, equals the record's OWN value (both
 * blank counts as unchanged). An input that doesn't parse is never "unchanged": the server answers it with its sentence.
 */
export function customUnchanged(kind: CustomKind, input: string, own: string | null, options: readonly string[] = []): boolean {
  const typed = editorForm(kind, input, kind === "choice" && own !== null && !options.includes(own) ? [...options, own] : options);
  if (typed === undefined) return false;
  if (own === null) return typed === null;
  const held = kind === "money" ? editorForm(kind, own, options) : own;
  return typed === held;
}
