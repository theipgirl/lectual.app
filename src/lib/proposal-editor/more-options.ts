/**
 * "More options" (Sprint 28 C): the one closed section of the proposal builder that holds
 * everything a person rarely changes. Pure, so the count, the summary and the "open it on an
 * error" rule are tested without a browser.
 */

import type { ProposalPricing } from "@/lib/proposals/types";

export const MORE_OPTIONS_LABEL = "More options";

/** "More options", or "More options - 2 changed" once something differs from the firm's defaults. */
export function moreOptionsSummary(changed: number): string {
  return changed > 0 ? `${MORE_OPTIONS_LABEL} - ${changed} changed` : MORE_OPTIONS_LABEL;
}

/** How many fields differ from their default. Compared as trimmed text, so "4950" and " 4950 " agree. */
export function countChangedFields(fields: ReadonlyArray<{ current: string; baseline: string }>): number {
  return fields.filter((f) => f.current.trim() !== f.baseline.trim()).length;
}

/** The validation paths whose fields live inside More options. */
const MORE_PATH =
  /^(pricing\.(base_cents|included_classes|per_class_cents|second_mark_discount_pct|gov_per_class_cents|reduce_under_included)|greeting|recommendation|office_action_note|adjustments(\[|$|\.)|includes(\[|$|\.)|title|expires_on|client\.(first_name|company)|names\[\d+\]\.(what|note|price_override|marks\[\d+\]\.desc))/;

export function pathInMoreOptions(path: string): boolean {
  return MORE_PATH.test(path);
}

/** True when any validation issue sits on a field inside More options, so the section opens by itself. */
export function shouldOpenMore(paths: readonly string[]): boolean {
  return paths.some(pathInMoreOptions);
}

/**
 * The same question for a refusal that comes back as a sentence ("Second-mark discount: enter a
 * percentage from 0 to 100."). The parsers always begin with the field's label.
 */
const MORE_LABELS = [
  "price",
  "base price",
  "price per class",
  "classes included",
  "second-mark discount",
  "second mark discount",
  "uspto fee",
  "expiry date",
  "title",
  "this brand",
];

export function messageInMoreOptions(message: string | null | undefined): boolean {
  if (!message) return false;
  const label = message.split(":")[0]?.trim().toLowerCase() ?? "";
  return MORE_LABELS.some((l) => label === l || label.startsWith(`${l} `));
}

/**
 * The editor's count: the five package numbers that differ from the firm's package of the same name
 * (none are counted when the name is not on the firm's list: there is nothing to differ from), the custom-package
 * switch, every discount or credit, and every brand name with its own price.
 */
export function editorChangedCount(input: {
  pricing: ProposalPricing;
  firmPackage: ProposalPricing | null;
  adjustments: number;
  brandPriceOverrides: number;
}): number {
  const { pricing, firmPackage } = input;
  let n = 0;
  if (firmPackage) {
    n += countChangedFields([
      { current: String(pricing.base_cents), baseline: String(firmPackage.base_cents) },
      { current: String(pricing.included_classes), baseline: String(firmPackage.included_classes) },
      { current: String(pricing.per_class_cents), baseline: String(firmPackage.per_class_cents) },
      { current: String(pricing.second_mark_discount_pct), baseline: String(firmPackage.second_mark_discount_pct) },
      { current: String(pricing.gov_per_class_cents), baseline: String(firmPackage.gov_per_class_cents) },
    ]);
  }
  if (pricing.reduce_under_included === true) n += 1;
  return n + Math.max(0, input.adjustments) + Math.max(0, input.brandPriceOverrides);
}
