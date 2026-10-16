/**
 * Pure helpers for the trademark/copyright fields 0035 added to `crm_matter`
 * (serial number, registration number, filing basis, filing + registration
 * dates, international classes, goods & services, examining attorney, USPTO
 * status). No server imports — client components import this directly.
 *
 * Everything here is parsing, labelling, and validation of what a human typed.
 * Nothing here invents a value: an absent field parses to `null` and renders as
 * empty, never as a plausible-looking default.
 */

import type { Database } from "@/lib/db/types";

export type FilingBasis = Database["public"]["Enums"]["crm_filing_basis"];

export const FILING_BASES = ["1a", "1b", "44d", "44e", "66a"] as const;

/**
 * Labels for the statutory filing bases. Wording names the statute and what it
 * is — it does not advise on which one applies; that is the attorney's call.
 */
export const FILING_BASIS_LABEL: Record<FilingBasis, string> = {
  "1a": "§1(a) — Use in commerce",
  "1b": "§1(b) — Intent to use",
  "44d": "§44(d) — Foreign priority claim",
  "44e": "§44(e) — Foreign registration",
  "66a": "§66(a) — Madrid Protocol extension",
};

export function isFilingBasis(value: unknown): value is FilingBasis {
  return typeof value === "string" && (FILING_BASES as readonly string[]).includes(value);
}

export function filingBasisLabel(basis: FilingBasis | null | undefined): string | null {
  return basis && isFilingBasis(basis) ? FILING_BASIS_LABEL[basis] : null;
}

/** Nice Classification runs 1–45. */
export const MIN_NICE_CLASS = 1;
export const MAX_NICE_CLASS = 45;

/**
 * Parses a typed class list ("9, 25 35" / "009,025") into sorted, de-duplicated
 * class numbers. Returns `null` for an empty input — an empty array is not "no
 * classes recorded", it is a malformed value, and 0035's CHECK rejects it.
 *
 * Throws on anything that is not a class number in range, rather than dropping
 * it silently: quietly discarding a class the attorney typed is exactly the
 * kind of invisible data loss a docketing system must not do.
 */
export function parseInternationalClasses(input: string | null | undefined): number[] | null {
  if (input == null) return null;
  const tokens = input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const classes: number[] = [];
  for (const token of tokens) {
    if (!/^\d{1,3}$/.test(token)) {
      throw new Error(`"${token}" is not an international class number.`);
    }
    const n = Number(token);
    if (n < MIN_NICE_CLASS || n > MAX_NICE_CLASS) {
      throw new Error(
        `International class ${n} is out of range — classes run ${MIN_NICE_CLASS}–${MAX_NICE_CLASS}.`,
      );
    }
    if (!classes.includes(n)) classes.push(n);
  }
  return classes.sort((a, b) => a - b);
}

/** "9, 25, 35" — the form value and the display value are the same string. */
export function formatInternationalClasses(classes: readonly number[] | null | undefined): string {
  if (!classes || classes.length === 0) return "";
  return classes.join(", ");
}

/**
 * Trims a typed value to `null` when blank. Used for every optional text field
 * so a cleared input stores NULL (genuinely empty) rather than "".
 */
export function blankToNull(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validates a `<input type="date">` value. Returns null for blank; throws on a
 * value the browser did not produce (a hand-crafted POST), so a malformed date
 * never reaches the docket.
 */
export function parseCivilDate(value: FormDataEntryValue | null | undefined): string | null {
  const raw = blankToNull(value);
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`"${raw}" is not a valid date (expected YYYY-MM-DD).`);
  }
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error(`"${raw}" is not a real calendar date.`);
  }
  return raw;
}

/**
 * `Mon D, YYYY` for a civil (`date`) column. Formatted in UTC on purpose: a
 * `date` has no time zone, and letting the runtime localise it shifts a filing
 * or docket date by a day for anyone west of Greenwich.
 */
export function formatCivilDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
