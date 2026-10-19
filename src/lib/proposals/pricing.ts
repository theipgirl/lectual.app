/**
 * Proposal arithmetic — what a client owes now, and what the USPTO charges at filing.
 *
 * Pure module: no database, no `server-only`, no `new Date()`, no formatting.
 * Safe to import from a `"use client"` component (the public page and the
 * editor preview run the SAME function the server runs at acceptance) and from
 * a plain vitest run.
 *
 * ── PORTED EXACTLY ──────────────────────────────────────────────────────────
 * From `lawmatics-mcp/src/proposals.ts#quoteProposal` (dollars there, integer
 * cents here), plus the two things the database-backed proposal adds:
 * `price_override` per brand name, and `adjustments` (consultation credit and
 * the like) on the legal fee.
 *
 *   per name:  n = picked classes
 *              base = (override.base ?? base) + (override.per_class ?? per_class)
 *                       * ((n || all classes of the name) - included_classes)
 *              picked marks in content order; the first is `base`, each later
 *              one is round(base * (100 - pct) / 100)
 *              included only when n > 0 AND >= 1 mark is picked
 *              gov = n * picked marks * gov_per_class
 *   legal_subtotal = sum of the names' legal fees
 *   adjustments apply only when legal_subtotal > 0; a percent one is taken off
 *   the SUBTOTAL, rounded once; legal_total = max(0, subtotal - discounts)
 *   gov_total is separate: "due at filing", never added to the legal fee.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * Integer cents. Rounding happens in exactly two places, both here and both
 * once per figure: a second mark's discounted price and a percent adjustment.
 * There is deliberately NO display formatter (formatting is rendering work) and
 * NO bare `total` on the result: `legal_total_cents` and `gov_total_cents` say
 * what each is, so "Total: $X" cannot silently mean "pay this today" when it
 * includes the USPTO's fee.
 *
 * ── TOTAL, NOT THROWING ─────────────────────────────────────────────────────
 * The content is a jsonb column that an agent or a person edited. A missing
 * array, a string where a number belongs, NaN: none of these throw. Unreadable
 * numbers read as 0, percentages are clamped to 0..100, a negative amount
 * adjustment takes nothing off, and a name whose price would go below zero is
 * priced at zero. `validate.ts` is where those are reported; this file is
 * where they cannot take the client's page down.
 */

import type {
  ProposalAdjustment,
  ProposalContent,
  ProposalQuote,
  QuotedAdjustment,
  QuotedMark,
  QuotedName,
  Selection,
} from "./types";

/** A finite number rounded to an integer cents/count; anything else is 0. */
function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function pct(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, n));
}

function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A price after a percent off, rounded once. */
function percentOff(cents: number, percent: number): number {
  return Math.round((cents * (100 - pct(percent))) / 100);
}

/** `percent` of `cents`, rounded once. */
function percentOf(cents: number, percent: number): number {
  return Math.round((cents * pct(percent)) / 100);
}

/**
 * Price the proposal for a selection. `selection[id] === true` means ticked;
 * anything else (absent, false, a truthy non-boolean) means not ticked, so a
 * hand-built request body cannot tick a box with `1` or `"true"`.
 */
export function quoteProposal(content: ProposalContent, selection: Selection): ProposalQuote {
  const on = (id: string) => selection != null && selection[id] === true;
  const pricing = obj(content?.pricing);
  const baseCents = int(pricing.base_cents);
  const perClassCents = int(pricing.per_class_cents);
  const includedClasses = int(pricing.included_classes);
  const secondMarkPct = pct(pricing.second_mark_discount_pct);
  const govPerClassCents = int(pricing.gov_per_class_cents);

  const names: QuotedName[] = arr<ProposalContent["names"][number]>(content?.names).map((nm) => {
    const allClasses = arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes);
    const picked = allClasses.filter((c) => on(c.id));
    const n = picked.length;
    const override = obj(nm?.price_override);
    const nameBase = override.base_cents == null ? baseCents : int(override.base_cents);
    const namePerClass = override.per_class_cents == null ? perClassCents : int(override.per_class_cents);
    const base = Math.max(0, nameBase + namePerClass * ((n || allClasses.length) - includedClasses));

    const marks: QuotedMark[] = arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks)
      .filter((m) => on(m.id))
      .map((m, i) => ({
        id: m.id,
        kind: m.kind,
        desc: m.desc,
        second: i > 0,
        price_cents: i > 0 ? percentOff(base, secondMarkPct) : base,
      }));

    const included = n > 0 && marks.length > 0;
    const legal = included ? marks.reduce((sum, m) => sum + m.price_cents, 0) : 0;
    return {
      id: nm?.id,
      name: nm?.name,
      included,
      classes: included ? picked.map((c) => ({ id: c.id, label: c.label })) : [],
      marks: included ? marks : [],
      base_cents: base,
      legal_cents: legal,
      gov_cents: included ? n * marks.length * govPerClassCents : 0,
      class_count: included ? n * marks.length : 0,
    };
  });

  const legalSubtotal = names.reduce((sum, x) => sum + x.legal_cents, 0);

  // Adjustments come off a positive subtotal only, in content order. Each is
  // capped at what is left, so the per-line figures always add up to the total
  // discount and the total never goes below zero.
  let remaining = legalSubtotal;
  const adjustments: QuotedAdjustment[] = arr<ProposalAdjustment>(content?.adjustments).map((a) => {
    const raw = a?.kind === "percent" ? percentOf(legalSubtotal, a.value) : Math.max(0, int(a?.value));
    const taken = legalSubtotal > 0 ? Math.min(Math.max(0, raw), remaining) : 0;
    remaining -= taken;
    return { id: a?.id, label: a?.label, kind: a?.kind === "percent" ? "percent" : "amount", value: a?.value, discount_cents: taken };
  });
  const discount = legalSubtotal - remaining;

  return {
    names,
    legal_subtotal_cents: legalSubtotal,
    adjustments,
    discount_cents: discount,
    legal_total_cents: Math.max(0, legalSubtotal - discount),
    gov_total_cents: names.reduce((sum, x) => sum + x.gov_cents, 0),
    gov_class_count: names.reduce((sum, x) => sum + x.class_count, 0),
  };
}

/** The firm's offer as first shown: every `preselected` mark and class ticked, the rest explicitly off. */
export function defaultSelection(content: ProposalContent): Selection {
  const selection: Selection = {};
  for (const nm of arr<ProposalContent["names"][number]>(content?.names)) {
    for (const m of arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks)) {
      selection[m.id] = m.preselected === true;
    }
    for (const c of arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes)) {
      selection[c.id] = c.preselected === true;
    }
  }
  return selection;
}

/**
 * A selection reduced to what the content actually offers: every mark and class
 * id appears once, as a real boolean, and anything else a caller sent is dropped.
 * Used on the way into `accepted_selection` so a hand-built request cannot stash
 * arbitrary keys in the firm's record.
 */
export function normalizeSelection(content: ProposalContent, raw: unknown): Selection {
  const given = obj(raw);
  const selection: Selection = {};
  for (const nm of arr<ProposalContent["names"][number]>(content?.names)) {
    for (const m of arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks)) {
      selection[m.id] = given[m.id] === true;
    }
    for (const c of arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes)) {
      selection[c.id] = given[c.id] === true;
    }
  }
  return selection;
}

/** True when the quote has at least one brand name in it (something to accept). */
export function quoteHasItems(quote: ProposalQuote): boolean {
  return quote.names.some((n) => n.included);
}
