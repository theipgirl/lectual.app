/**
 * The firm's packages as a named list, with no schema change.
 *
 * `client_proposal_setting.pricing` is a jsonb. It has always held one package
 * as six flat fields (`package`, `base_cents`, ...). It now may also hold
 * `packages`: an array of the same six-field shape, first one the default.
 *
 * Pure and client-safe (no `server-only`, no clock): the settings card, the
 * New proposal dropdown, the validator and the server actions all read the same
 * three functions.
 *
 *   normalisePackages  total. A valid `packages` array is used as is; anything
 *                      missing or unreadable falls back to the flat fields, which
 *                      fall back field by field to the RPB defaults. It never throws.
 *   validatePackages   the rules a saved list must meet, each as a sentence.
 *   withPackages       writes the list AND the flat fields from the first package,
 *                      so a reader that has never heard of `packages` still works.
 */

import { centsToInput } from "@/lib/quotes/money";
import { formatDollars } from "@/lib/proposal-editor/events";
import type { ProposalPricing } from "./types";

/** RPB's Concierge package, from the Sevetri example, in cents. */
export const DEFAULT_PROPOSAL_PRICING: ProposalPricing = {
  package: "Concierge",
  base_cents: 495_000,
  included_classes: 3,
  per_class_cents: 82_500,
  second_mark_discount_pct: 20,
  gov_per_class_cents: 35_000,
};

export const MAX_PACKAGES = 20;
export const MAX_PACKAGE_NAME_CHARS = 120;

const MONEY_FIELDS = [
  ["base_cents", "Price with the included classes"],
  ["per_class_cents", "Per class over / under"],
  ["gov_per_class_cents", "USPTO fee per class per mark"],
] as const;

function nonNegInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** One package from the flat fields of `raw`; any field that is missing or malformed takes the RPB default. */
function flatPackage(raw: Record<string, unknown>): ProposalPricing {
  const d = DEFAULT_PROPOSAL_PRICING;
  const pct = raw.second_mark_discount_pct;
  return {
    package: typeof raw.package === "string" && raw.package.trim() ? raw.package.trim() : d.package,
    base_cents: nonNegInt(raw.base_cents, d.base_cents),
    included_classes: nonNegInt(raw.included_classes, d.included_classes),
    per_class_cents: nonNegInt(raw.per_class_cents, d.per_class_cents),
    second_mark_discount_pct: typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : d.second_mark_discount_pct,
    gov_per_class_cents: nonNegInt(raw.gov_per_class_cents, d.gov_per_class_cents),
  };
}

/** A well-formed element of `packages`, or null. Every field must already be right: nothing is repaired here. */
function listedPackage(value: unknown): ProposalPricing | null {
  if (!isObject(value)) return null;
  const name = typeof value.package === "string" ? value.package.trim() : "";
  const pct = value.second_mark_discount_pct;
  if (!name || name.length > MAX_PACKAGE_NAME_CHARS) return null;
  for (const [key] of MONEY_FIELDS) {
    if (typeof value[key] !== "number" || !Number.isInteger(value[key]) || (value[key] as number) < 0) return null;
  }
  if (typeof value.included_classes !== "number" || !Number.isInteger(value.included_classes) || value.included_classes < 0) return null;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return {
    package: name,
    base_cents: value.base_cents as number,
    included_classes: value.included_classes,
    per_class_cents: value.per_class_cents as number,
    second_mark_discount_pct: pct,
    gov_per_class_cents: value.gov_per_class_cents as number,
  };
}

/**
 * The firm's packages, first one the default. Always at least one: a setting
 * with no usable `packages` array is one package built from the flat fields
 * (today's "Concierge" when those are absent too). A name listed twice keeps
 * its first entry.
 */
export function normalisePackages(pricing: unknown): ProposalPricing[] {
  const raw = isObject(pricing) ? pricing : {};
  if (Array.isArray(raw.packages)) {
    const seen = new Set<string>();
    const list: ProposalPricing[] = [];
    for (const item of raw.packages.slice(0, MAX_PACKAGES)) {
      const p = listedPackage(item);
      if (!p || seen.has(p.package.toLowerCase())) continue;
      seen.add(p.package.toLowerCase());
      list.push(p);
    }
    if (list.length > 0) return list;
  }
  return [flatPackage(raw)];
}

export type PackageIssue = {
  /** Zero-based position in the list; -1 for a problem with the list itself. */
  index: number;
  /** The `ProposalPricing` key the sentence is about, when it is about one. */
  field: keyof ProposalPricing | null;
  message: string;
};

/**
 * What a list must meet to be saved: at least one package; a name each, unique
 * ignoring case; money in whole cents, zero or more; classes included 1 or
 * more; a second-mark discount from 0 to 100. Total: takes anything.
 */
export function validatePackages(list: unknown): PackageIssue[] {
  const out: PackageIssue[] = [];
  if (!Array.isArray(list) || list.length === 0) {
    return [{ index: -1, field: null, message: "Keep at least one package." }];
  }
  if (list.length > MAX_PACKAGES) out.push({ index: -1, field: null, message: `A firm can list at most ${MAX_PACKAGES} packages.` });

  const seen = new Map<string, number>();
  list.slice(0, MAX_PACKAGES).forEach((item, index) => {
    const where = `Package ${index + 1}`;
    if (!isObject(item)) {
      out.push({ index, field: null, message: `${where}: this isn't a package.` });
      return;
    }
    const name = typeof item.package === "string" ? item.package.trim() : "";
    const label = name ? `${where} (${name})` : where;
    if (!name) out.push({ index, field: "package", message: `${where}: give the package a name.` });
    else if (name.length > MAX_PACKAGE_NAME_CHARS) out.push({ index, field: "package", message: `${label}: the name can be ${MAX_PACKAGE_NAME_CHARS} characters at most.` });
    else {
      const key = name.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) out.push({ index, field: "package", message: `${label}: another package already uses that name (package ${first + 1}). Names must be different.` });
      else seen.set(key, index);
    }
    for (const [key, what] of MONEY_FIELDS) {
      const v = item[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) out.push({ index, field: key, message: `${label}: ${what} must be a dollar amount of zero or more.` });
    }
    const classes = item.included_classes;
    if (typeof classes !== "number" || !Number.isInteger(classes) || classes < 1) {
      out.push({ index, field: "included_classes", message: `${label}: Classes included must be 1 or more.` });
    }
    const pct = item.second_mark_discount_pct;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      out.push({ index, field: "second_mark_discount_pct", message: `${label}: the second mark discount must be between 0 and 100 percent.` });
    }
  });
  return out;
}

/**
 * `pricing` with the list stored under `packages` and the six flat fields
 * written from the FIRST package, so an older reader (and `standardProposalPricing`
 * on a stale deploy) sees the default package. Every other key (includes,
 * the office-action note, anything unknown) is kept. Does not validate.
 */
export function withPackages(pricing: Record<string, unknown>, list: readonly ProposalPricing[]): Record<string, unknown> {
  const copy = list.map((p) => ({ ...p }));
  const first = copy[0];
  return first ? { ...pricing, ...first, packages: copy } : { ...pricing };
}

/** "3 classes" / "1 class". */
export function classCountLabel(n: number): string {
  return `${n} ${n === 1 ? "class" : "classes"}`;
}

/** The package whose name matches `name`, ignoring case and outer spaces. */
export function findPackage(list: readonly ProposalPricing[], name: string): ProposalPricing | undefined {
  const key = name.trim().toLowerCase();
  return key ? list.find((p) => p.package.toLowerCase() === key) : undefined;
}

/** A package as the New proposal form needs it: strings for the inputs and the dropdown's words. */
export type PackageOption = {
  name: string;
  /** "$4,950 · 3 classes". */
  summary: string;
  base: string;
  includedClasses: string;
  perClass: string;
  secondMarkPct: string;
  govPerClass: string;
};

export function packageOption(p: ProposalPricing): PackageOption {
  return {
    name: p.package,
    summary: `${formatDollars(p.base_cents)} · ${classCountLabel(p.included_classes)}`,
    base: centsToInput(p.base_cents),
    includedClasses: String(p.included_classes),
    perClass: centsToInput(p.per_class_cents),
    secondMarkPct: String(p.second_mark_discount_pct),
    govPerClass: centsToInput(p.gov_per_class_cents),
  };
}
