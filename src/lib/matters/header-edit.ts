import { isMatterType, type MatterType } from "./matter-types";

/**
 * Pure rules for the matter header edit (title, package, type, "Came from").
 * No DB, no server-only imports, so the form and the data layer share one set
 * of limits and the rules are unit tested on their own.
 */

export const MATTER_TITLE_MAX = 200;
export const MATTER_PACKAGE_MAX = 120;
export const MATTER_REFERRAL_MAX = 200;

/** The header columns, as the table stores them. */
export type MatterHeaderValues = {
  title: string | null;
  package_name: string | null;
  type: MatterType;
  referral_source: string | null;
};

/** What a form posted. A key left out means "leave this column alone". */
export type MatterHeaderInput = {
  title?: string | null;
  packageName?: string | null;
  type?: string | null;
  referralSource?: string | null;
};

export type MatterHeaderChanges = Partial<MatterHeaderValues>;

export type MatterHeaderResult =
  | { ok: true; changes: MatterHeaderChanges; fields: (keyof MatterHeaderValues)[] }
  | { ok: false; error: string };

export const LITIGATION_TYPE_CHANGE_COPY =
  "Litigation matters keep their own case number and case details, so a matter can't be changed to or from Litigation. Open a new matter instead.";

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Checks a posted header against the matter as it is now and returns ONLY the
 * columns that would change. Blank text saves as null. A post that changes
 * nothing returns an empty change set, which the caller turns into "no write,
 * no timeline row".
 */
export function validateMatterHeader(input: MatterHeaderInput, current: MatterHeaderValues): MatterHeaderResult {
  const changes: MatterHeaderChanges = {};

  const text: Array<[keyof MatterHeaderInput, "title" | "package_name" | "referral_source", number, string]> = [
    ["title", "title", MATTER_TITLE_MAX, "Title"],
    ["packageName", "package_name", MATTER_PACKAGE_MAX, "Package"],
    ["referralSource", "referral_source", MATTER_REFERRAL_MAX, "Came from"],
  ];
  for (const [key, column, max, label] of text) {
    if (input[key] === undefined) continue;
    const next = blankToNull(input[key]);
    if (next !== null && next.length > max) {
      return { ok: false, error: `${label} must be ${max} characters or fewer.` };
    }
    if (next !== current[column]) changes[column] = next;
  }

  if (input.type !== undefined) {
    if (!isMatterType(input.type)) return { ok: false, error: "Choose a valid matter type." };
    if (input.type !== current.type) {
      if (input.type === "LIT" || current.type === "LIT") {
        return { ok: false, error: LITIGATION_TYPE_CHANGE_COPY };
      }
      changes.type = input.type;
    }
  }

  return { ok: true, changes, fields: Object.keys(changes) as (keyof MatterHeaderValues)[] };
}
