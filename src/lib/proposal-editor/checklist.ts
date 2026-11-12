/**
 * "Ready to send?": what blocks the link, built from the SAME issues `validateContent(..., forApproval)` gives
 * (the page and the approval step can never disagree). Each item links to the field that can fix it, so the
 * checklist is useful from the first load, before any save has failed.
 *
 * Pure: no database. The ids it returns are the ids the editor's fields carry (`fieldId`); the render test
 * checks that every target exists in the markup.
 */

import type { ProposalContent } from "@/lib/proposals/types";
import type { ValidationIssue } from "@/lib/proposals/validate";
import { describeIssuePath } from "./issues";

/** The id of an editor field or card. One place, so the page and the checklist agree. */
export const fieldId = {
  fullName: "pe-f-fullName",
  clientEmail: "pe-f-clientEmail",
  firstName: "pe-f-firstName",
  company: "pe-f-company",
  title: "pe-f-title",
  greeting: "pe-f-greeting",
  recommendation: "pe-f-recommendation",
  officeActionNote: "pe-f-officeActionNote",
  payUrl: "pe-f-payUrl",
  expiresOn: "pe-f-expiresOn",
  adjustments: "pe-f-adjustments",
  includes: "pe-f-includes",
  general: "pe-f-general",
  pricing: (key: string) => `pe-f-pricing-${key}`,
  brand: (i: number) => `pe-f-brand-${i}`,
  brandName: (i: number) => `pe-f-brand-${i}-name`,
  brandMarks: (i: number) => `pe-f-brand-${i}-marks`,
  brandClasses: (i: number) => `pe-f-brand-${i}-classes`,
  brandPackage: (i: number) => `pe-f-brand-${i}-package`,
  brandDiscount: (i: number) => `pe-f-brand-${i}-discount`,
} as const;

/** The four main sections: the fallback for an issue with no single field. */
export const sectionId = { who: "pe-sec-who", brands: "pe-sec-brands", fees: "pe-sec-fees", message: "pe-sec-message" } as const;

/** The id of the field that fixes the issue at `path`. */
export function targetForPath(path: string): string {
  const name = /^names\[(\d+)\](?:\.(.*))?$/.exec(path);
  if (name) {
    const i = Number(name[1]);
    const rest = name[2] ?? "";
    if (/^marks/.test(rest)) return fieldId.brandMarks(i);
    if (/^classes/.test(rest)) return fieldId.brandClasses(i);
    if (/^(package_choice|price_override)/.test(rest)) return fieldId.brandPackage(i);
    if (/^discount_pct/.test(rest)) return fieldId.brandDiscount(i);
    if (/^name$/.test(rest)) return fieldId.brandName(i);
    return fieldId.brand(i);
  }
  if (path === "client.full_name" || path === "client") return fieldId.fullName;
  if (path === "client.first_name") return fieldId.firstName;
  if (path === "client.company") return fieldId.company;
  if (path === "client_email") return fieldId.clientEmail;
  if (path === "title") return fieldId.title;
  if (path === "pay_url") return fieldId.payUrl;
  if (path === "expires_on") return fieldId.expiresOn;
  if (path === "greeting") return fieldId.greeting;
  if (path === "recommendation") return fieldId.recommendation;
  if (path === "office_action_note") return fieldId.officeActionNote;
  if (/^adjustments(\[|$|\.)/.test(path)) return fieldId.adjustments;
  if (/^includes(\[|$|\.)/.test(path)) return fieldId.includes;
  if (path === "pricing.package") return fieldId.pricing("package");
  const price = /^pricing\.(base_cents|included_classes|per_class_cents|second_mark_discount_pct|gov_per_class_cents)$/.exec(path);
  if (price) return fieldId.pricing(price[1]);
  if (/^pricing(\.|$)/.test(path)) return fieldId.pricing("package");
  if (/^general(\.|$)/.test(path)) return fieldId.general;
  return sectionId.brands;
}

export type ChecklistItem = { level: "error" | "warning"; text: string; where: string; href: string };

/** The checklist: errors (they block the link) first, then things to check; page order within each. */
export function buildChecklist(issues: readonly ValidationIssue[], content: ProposalContent | null): ChecklistItem[] {
  const items = issues.map((i) => ({
    level: i.level,
    text: i.message,
    where: describeIssuePath(i.path, content),
    href: `#${targetForPath(i.path)}`,
  }));
  return [...items.filter((i) => i.level === "error"), ...items.filter((i) => i.level !== "error")];
}

/** How many items block the link. */
export function blockingCount(items: readonly ChecklistItem[]): number {
  return items.filter((i) => i.level === "error").length;
}
