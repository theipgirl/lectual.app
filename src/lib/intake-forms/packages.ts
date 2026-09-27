import { formatCents } from "@/lib/quotes/money";
import type { ServiceItemRow } from "@/lib/quotes/types";
import type { IntakeFormConfig } from "./config";

/**
 * Fee packages on the intake come from the firm's service library
 * (`crm_service_item`, the same rows the quote builder picks from): ACTIVE
 * items of kind `legal_fee`. A USPTO filing fee or an expense is not a
 * package a founder chooses, so neither is offered.
 *
 * Prices are the library's `unit_amount_cents`, formatted — exactly as
 * written, read at render time, never copied into the intake config and never
 * estimated. The config only records which items are shown.
 */

export type LibraryItem = Pick<ServiceItemRow, "id" | "label" | "description" | "kind" | "unit_amount_cents" | "active" | "sort_index">;

export type IntakePackage = { id: string; name: string; price: string; includes: string; visible: boolean };

export function isOfferablePackage(item: LibraryItem): boolean {
  return item.active && item.kind === "legal_fee";
}

/** The fee section's rows: every offerable item, with its show/hide state. */
export function intakePackages(items: LibraryItem[], visibleIds: string[]): IntakePackage[] {
  const shown = new Set(visibleIds);
  return items
    .filter(isOfferablePackage)
    .sort((a, b) => a.sort_index - b.sort_index)
    .map((i) => ({
      id: i.id,
      name: i.label,
      price: formatCents(i.unit_amount_cents),
      includes: i.description ?? "",
      visible: shown.has(i.id),
    }));
}

/**
 * What a prospect sees: shown items only, and nothing at all when the firm
 * switched fees off. No ids — a library id is the firm's business.
 */
export function publicPackages(
  items: LibraryItem[],
  config: Pick<IntakeFormConfig, "feesOn" | "visiblePackageIds">,
): { name: string; price: string; includes: string }[] {
  if (!config.feesOn) return [];
  return intakePackages(items, config.visiblePackageIds)
    .filter((p) => p.visible)
    .map(({ name, price, includes }) => ({ name, price, includes }));
}
