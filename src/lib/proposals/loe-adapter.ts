/**
 * An ACCEPTED proposal as the input of the trademark LOE draft (Sprint 19).
 *
 * Pure: no database, no clock (the date is passed in), no model. It reads the frozen
 * `accepted_snapshot`, what the client was shown and agreed to, and never re-prices
 * anything. `buildTrademarkLoeDraft` (documents/loe.ts) turns the result into the draft
 * text; this file only decides what goes into it, and when NOT to draft at all.
 *
 * ── FIRM RULES THAT SHAPE IT ────────────────────────────────────────────────
 *  - Legal fee and USPTO fees are two figures, never added. `amountPaid` is the legal
 *    total; `govFeesText` is the USPTO total, printed as the quote's own number.
 *  - The variant is never guessed (SOP hard rule 2). A package that is not on the firm's
 *    current list gets no draft and "Choose the LOE template". `legacy` is never chosen here.
 *  - `TrademarkLoeInput` is ONE mark. More than one accepted brand name is not split by
 *    guesswork: it gets no draft and a sentence pointing at the LOE form.
 *  - Only the rows the chosen package includes are charted. A proposal's `includes` table
 *    is that package's table already, so "included" is judged per row by its own cell.
 */

import type { TrademarkLoeInput } from "@/lib/documents/loe";
import { formatDollars } from "@/lib/proposal-editor/events";
import { findPackage } from "./package-list";
import type { AcceptedSnapshot, ProposalContent, ProposalPricing, ProposalQuote, QuotedName } from "./types";

export type LoeRefusal = "no_brand" | "multiple_brands" | "unknown_package" | "package_list_unreadable";

/** The sentence shown for each refusal. `unknown_package` is paired with the "Choose the LOE template" heading. */
export const LOE_REFUSAL_TEXT: Record<LoeRefusal, string> = {
  no_brand: "No brand name was accepted, so there is nothing to draft an engagement letter for.",
  multiple_brands: "More than one brand was accepted. Draft each engagement letter from the LOE form.",
  unknown_package: "This package isn't on the firm's current package list, so no engagement letter was drafted.",
  package_list_unreadable: "Couldn't check the firm's package list, so no engagement letter was drafted.",
};

export const CHOOSE_LOE_TEMPLATE = "Choose the LOE template";

/* ─────────────────────────── the variant ────────────────────────────────── */

export type LoeVariantResult = { ok: true; variant: "current" } | { ok: false; reason: "unknown_package" | "package_list_unreadable" };

/**
 * `current` only when the accepted package is named (any letter case, extra spaces) in the
 * firm's current list. An unreadable list (`null`) is its own answer, never "unknown" and
 * never `current`.
 */
export function loeVariantFor(packageName: unknown, packages: readonly ProposalPricing[] | null): LoeVariantResult {
  if (packages === null) return { ok: false, reason: "package_list_unreadable" };
  const name = typeof packageName === "string" ? packageName : "";
  return findPackage(packages, name) ? { ok: true, variant: "current" } : { ok: false, reason: "unknown_package" };
}

/* ─────────────────────────── the chart ──────────────────────────────────── */

const NOT_INCLUDED = new Set(["", "-", "—", "–", "no", "none", "n/a"]);

/** True when a row's `included` cell says the package has it. Blank and the dash family do not. */
export function isIncludedCell(cell: unknown): boolean {
  const text = typeof cell === "string" ? cell.replace(/\s+/g, " ").trim().toLowerCase() : "";
  return !NOT_INCLUDED.has(text);
}

function classesCell(n: number): string {
  return `${n} ${n === 1 ? "Class" : "Classes"}`;
}

/** "Preliminary Consultation Strategy Call ($450) | ✓": the label, the à-la-carte value in brackets when there is one, then the cell. */
function chartRow(row: ProposalContent["includes"][number]): string {
  const label = String(row.label ?? "").replace(/\s+/g, " ").trim();
  const value = typeof row.value === "string" ? row.value.replace(/\s+/g, " ").trim() : "";
  return `${label}${value ? ` (${value})` : ""} | ${String(row.included).replace(/\s+/g, " ").trim()}`;
}

/**
 * The chart's body rows for the chosen package: "Classes Included | N Classes" first
 * (from the package's own class count; the table's own "Classes included" row is replaced
 * by it), then every row whose cell says it is included, in order.
 */
export function chartRowsFor(content: ProposalContent): string[] {
  const included = Number.isInteger(content.pricing?.included_classes) ? content.pricing.included_classes : 0;
  const rows = (Array.isArray(content.includes) ? content.includes : [])
    .filter((r) => r && typeof r.label === "string" && r.label.trim() && isIncludedCell(r.included))
    .filter((r) => r.label.replace(/\s+/g, " ").trim().toLowerCase() !== "classes included")
    .map(chartRow);
  return [...(included > 0 ? [`Classes Included | ${classesCell(included)}`] : []), ...rows];
}

/* ─────────────────────────── the money lines ─────────────────────────────── */

/**
 * "$2,775 − $250 = $2,525": the legal subtotal, one subtraction per adjustment with what it
 * actually took off, and the legal total. Null when nothing was taken off. Gov fees are not
 * part of it.
 */
export function amountPaidMath(quote: ProposalQuote): string | null {
  const taken = (Array.isArray(quote.adjustments) ? quote.adjustments : []).filter((a) => a.discount_cents > 0);
  if (taken.length === 0) return null;
  return `${formatDollars(quote.legal_subtotal_cents)} ${taken.map((a) => `− ${formatDollars(a.discount_cents)}`).join(" ")} = ${formatDollars(quote.legal_total_cents)}`;
}

/**
 * The USPTO figure as the client saw it: the quote's own total, with the per-class math
 * beside it when that math agrees ("$700 ($350 × 2 classes)"). A firm that priced it
 * differently gets what was quoted, never a recomputed constant.
 */
export function govFeesText(quote: ProposalQuote, perClassCents: number, classCount: number): string {
  const total = formatDollars(quote.gov_total_cents);
  if (classCount > 0 && perClassCents > 0 && perClassCents * classCount === quote.gov_total_cents) {
    return `${total} (${formatDollars(perClassCents)} × ${classCount} ${classCount === 1 ? "class" : "classes"})`;
  }
  return total;
}

/* ─────────────────────────── the adapter ────────────────────────────────── */

export type LoeFacts = {
  /** The firm's current package list; `null` when it could not be read. */
  packages: readonly ProposalPricing[] | null;
  /** The send date, "YYYY-MM-DD", in the firm's zone. The signature deadline is this plus 14 days (loe.ts). */
  todayIso: string;
};

export type LoeAdapterResult = { ok: true; input: TrademarkLoeInput; brand: QuotedName } | { ok: false; reason: LoeRefusal };

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function loeInputFromAcceptedProposal(snapshot: AcceptedSnapshot, facts: LoeFacts): LoeAdapterResult {
  const { content, quote } = snapshot;
  const brands = (Array.isArray(quote?.names) ? quote.names : []).filter((n) => n.included);
  if (brands.length === 0) return { ok: false, reason: "no_brand" };
  if (brands.length > 1) return { ok: false, reason: "multiple_brands" };
  const brand = brands[0];

  // Spec 6: a brand name priced under a package the client chose names THAT package; it is looked up on the firm's
  // current list like any other ("Choose the LOE template" when it isn't there).
  const offer = brand.package ? (Array.isArray(content.packages) ? content.packages : []).find((p) => p?.package === brand.package) : undefined;
  const packageName = trimmed(brand.package) || trimmed(content.pricing?.package);
  const chartContent: ProposalContent = offer
    ? {
        ...content,
        pricing: { ...content.pricing, package: offer.package, included_classes: offer.included_classes },
        includes: Array.isArray(offer.includes) && offer.includes.length > 0 ? offer.includes : content.includes,
      }
    : content;
  const variant = loeVariantFor(packageName, facts.packages);
  if (!variant.ok) return { ok: false, reason: variant.reason };

  const company = trimmed(content.client?.company);
  return {
    ok: true,
    brand,
    input: {
      variant: variant.variant,
      clientName: trimmed(content.client?.full_name),
      entityName: company || null,
      markText: trimmed(brand.name),
      packageName,
      benefitRowsText: chartRowsFor(chartContent).join("\n"),
      classSelected: brand.classes.map((c) => trimmed(c.label)).filter(Boolean).join(", "),
      classCount: brand.class_count,
      amountPaid: formatDollars(quote.legal_total_cents),
      amountPaidMath: amountPaidMath(quote),
      sendDateIso: facts.todayIso,
      govFeesText: govFeesText(quote, offer ? offer.gov_per_class_cents : content.pricing?.gov_per_class_cents ?? 0, brand.class_count),
    },
  };
}

/* ─────────────────────────── the Lawmatics fields (stretch) ─────────────── */

/** Names a firm can map to its own Lawmatics custom fields, in display order. */
export const LOE_FIELD_NAMES = [
  "LOE Package",
  "LOE Fee Chart",
  "LOE Classes",
  "LOE Legal Fee",
  "LOE USPTO Fees",
  "LOE Signature Deadline",
] as const;
export type LoeFieldName = (typeof LOE_FIELD_NAMES)[number];

/** The chart flattened to one text, one row per line. */
export function flattenFeeChart(input: Pick<TrademarkLoeInput, "benefitRowsText" | "classSelected" | "amountPaid" | "amountPaidMath" | "markText" | "govFeesText">): string {
  const rows = input.benefitRowsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return [
    `Trademark Package — Word Mark – ${input.markText}`,
    ...rows,
    `Class Selected: ${input.classSelected}`,
    `Amount Paid: ${input.amountPaid}${input.amountPaidMath ? ` (${input.amountPaidMath})` : ""}`,
    `Government Filing Fees (Unpaid): ${input.govFeesText ?? ""}`.trimEnd(),
  ].join("\n");
}

function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The signature deadline the draft prints (send date + 14 days), computed here only for the field value. */
export const SIGNATURE_DEADLINE_DAYS = 14;

/**
 * The text each mapped Lawmatics field receives, from the SAME input the draft is built
 * from. Legal and USPTO are separate fields and nothing sums them.
 */
export function loeFieldValues(input: TrademarkLoeInput): Record<LoeFieldName, string> {
  return {
    "LOE Package": input.packageName,
    "LOE Fee Chart": flattenFeeChart(input),
    "LOE Classes": input.classSelected,
    "LOE Legal Fee": input.amountPaid,
    "LOE USPTO Fees": input.govFeesText ?? "",
    "LOE Signature Deadline": plusDays(input.sendDateIso, SIGNATURE_DEADLINE_DAYS),
  };
}
