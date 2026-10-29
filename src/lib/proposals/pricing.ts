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
 *                       * max(0, (n || all classes of the name) - included_classes)
 *              A package is its FLAT price up to its included classes (Sprint 28):
 *              fewer classes never lower it, each class past the included count adds
 *              the per-class price. `pricing.reduce_under_included === true` (a
 *              custom package, set by staff) restores the old reduction. Before Sprint 28 a name with fewer classes than
 *              included took the per-class price off; accepted snapshots keep the
 *              figure they were accepted at and are never re-priced.
 *              picked marks in content order; the first is `base`, each later
 *              one is round(base * (100 - pct) / 100)
 *              included only when n > 0 AND >= 1 mark is picked
 *              gov = n * picked marks * gov_per_class
 *   legal_subtotal = sum of the names' legal fees
 *   adjustments apply only when legal_subtotal > 0; a percent one is taken off
 *   the SUBTOTAL, rounded once; legal_total = max(0, subtotal - discounts)
 *   gov_total is separate: "due at filing", never added to the legal fee.
 *
 * ── SPEC 6: A PACKAGE PER BRAND NAME ────────────────────────────────────────
 *   A name with `package_choice` is priced under the package the client picked
 *   (`selection.packages[nameId]`, a NAME only; missing or unknown = the name's
 *   default), read from the proposal's own `content.packages` snapshot: its base,
 *   per-class price, included classes, second-mark percent and USPTO fee, always
 *   with the flat rule (never `reduce_under_included`). `price_override` does not
 *   apply to such a name (validate.ts refuses the pair).
 *   `discount_pct` (0..50) then comes off that name's legal fee, rounded once:
 *   legal = round(sum of marks * (100 - pct) / 100). The USPTO fee is never
 *   discounted. A name with neither prices exactly as before, byte for byte.
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
  PackageOffer,
  PackagePicks,
  ProposalAdjustment,
  ProposalPricing,
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

/** The most a brand name's own discount may take off (Spec 6). */
export const MAX_NAME_DISCOUNT_PCT = 50;

function nameDiscountPct(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(MAX_NAME_DISCOUNT_PCT, Math.max(0, n));
}

/** The proposal's package snapshot, by exact name (first one wins). */
function offersByName(content: ProposalContent): Map<string, PackageOffer> {
  const map = new Map<string, PackageOffer>();
  for (const raw of arr<PackageOffer>(content?.packages)) {
    const name = obj(raw).package;
    if (typeof name === "string" && name && !map.has(name)) map.set(name, raw);
  }
  return map;
}

/**
 * The packages a brand name's `package_choice` offers, in stored order: only names that exist in
 * `content.packages`, each once. Empty when the name has no (readable) choice.
 */
export function packageChoiceOptions(content: ProposalContent, name: unknown): PackageOffer[] {
  const choice = obj(obj(name).package_choice);
  const offers = offersByName(content);
  const out: PackageOffer[] = [];
  const seen = new Set<string>();
  for (const option of arr<unknown>(choice.options)) {
    if (typeof option !== "string" || seen.has(option)) continue;
    const offer = offers.get(option);
    if (!offer) continue;
    seen.add(option);
    out.push(offer);
  }
  return out;
}

/** The name's default package: `package_choice.default` when it is one of its options, else the first option. */
export function defaultPackageName(content: ProposalContent, name: unknown): string | null {
  const options = packageChoiceOptions(content, name);
  if (options.length === 0) return null;
  const wanted = obj(obj(name).package_choice).default;
  return options.find((o) => o.package === wanted)?.package ?? options[0].package;
}

/**
 * The package a brand name is priced under for this selection: the client's pick when it is one of the
 * name's options, otherwise the default. `null` for a name without a (readable) `package_choice`.
 */
export function chosenPackage(content: ProposalContent, name: unknown, selection: Selection | null | undefined): PackageOffer | null {
  const options = packageChoiceOptions(content, name);
  if (options.length === 0) return null;
  const id = obj(name).id;
  const picks = obj(selection?.packages);
  const asked = typeof id === "string" ? picks[id] : undefined;
  const picked = typeof asked === "string" ? options.find((o) => o.package === asked) : undefined;
  if (picked) return picked;
  const fallback = defaultPackageName(content, name);
  return options.find((o) => o.package === fallback) ?? options[0];
}

/** A package offer as `ProposalPricing` (always the flat rule). For display words; prices still come from `quoteProposal`. */
export function offerPricing(offer: PackageOffer): ProposalPricing {
  return {
    package: offer.package,
    base_cents: int(offer.base_cents),
    included_classes: int(offer.included_classes),
    per_class_cents: int(offer.per_class_cents),
    second_mark_discount_pct: pct(offer.second_mark_discount_pct),
    gov_per_class_cents: int(offer.gov_per_class_cents),
  };
}

/** Every brand name with a package choice -> the package it is priced under (a valid name, never a price). */
function resolvedPackagePicks(content: ProposalContent, selection: Selection | null | undefined): PackagePicks | null {
  const picks: PackagePicks = {};
  let any = false;
  for (const nm of arr<unknown>(content?.names)) {
    const offer = chosenPackage(content, nm, selection);
    const id = obj(nm).id;
    if (offer && typeof id === "string") {
      picks[id] = offer.package;
      any = true;
    }
  }
  return any ? picks : null;
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
  // Only a custom package ("$825 less per class under the included classes") sets
  // this; absent or anything but `true` is the flat package price.
  const reduceUnderIncluded = pricing.reduce_under_included === true;

  const names: QuotedName[] = arr<ProposalContent["names"][number]>(content?.names).map((nm) => {
    const allClasses = arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes);
    const picked = allClasses.filter((c) => on(c.id));
    const n = picked.length;
    // Spec 6: a name with a package choice is priced under the chosen package, always flat.
    const offer = chosenPackage(content, nm, selection);
    const override = offer ? {} : obj(nm?.price_override);
    const nameBase = offer ? int(offer.base_cents) : override.base_cents == null ? baseCents : int(override.base_cents);
    const namePerClass = offer ? int(offer.per_class_cents) : override.per_class_cents == null ? perClassCents : int(override.per_class_cents);
    const nameIncluded = offer ? int(offer.included_classes) : includedClasses;
    const nameSecondPct = offer ? pct(offer.second_mark_discount_pct) : secondMarkPct;
    const nameGov = offer ? int(offer.gov_per_class_cents) : govPerClassCents;
    const classDelta = (n || allClasses.length) - nameIncluded;
    const base = Math.max(0, nameBase + namePerClass * (reduceUnderIncluded && !offer ? classDelta : Math.max(0, classDelta)));

    const marks: QuotedMark[] = arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks)
      .filter((m) => on(m.id))
      .map((m, i) => ({
        id: m.id,
        kind: m.kind,
        desc: m.desc,
        second: i > 0,
        price_cents: i > 0 ? percentOff(base, nameSecondPct) : base,
      }));

    const included = n > 0 && marks.length > 0;
    const beforeDiscount = included ? marks.reduce((sum, m) => sum + m.price_cents, 0) : 0;
    // Spec 6: the brand name's own percent comes off its legal fee once, after the package price.
    const hasDiscount = typeof nm?.discount_pct === "number";
    const legal = hasDiscount ? percentOff(beforeDiscount, nameDiscountPct(nm.discount_pct)) : beforeDiscount;
    const quoted: QuotedName = {
      id: nm?.id,
      name: nm?.name,
      included,
      classes: included ? picked.map((c) => ({ id: c.id, label: c.label })) : [],
      marks: included ? marks : [],
      base_cents: base,
      legal_cents: legal,
      gov_cents: included ? n * marks.length * nameGov : 0,
      class_count: included ? n * marks.length : 0,
    };
    if (offer) quoted.package = offer.package;
    if (hasDiscount) quoted.discount_cents = beforeDiscount - legal;
    return quoted;
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

/** The firm's offer as first shown: every `preselected` mark and class ticked, the rest explicitly off (a fixed offer: all of it). */
export function defaultSelection(content: ProposalContent): Selection {
  const selection: Selection = {};
  if (isFixedOffer(content)) return fixedOfferSelection(content);
  for (const nm of arr<ProposalContent["names"][number]>(content?.names)) {
    for (const m of arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks)) {
      selection[m.id] = m.preselected === true;
    }
    for (const c of arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes)) {
      selection[c.id] = c.preselected === true;
    }
  }
  const packages = resolvedPackagePicks(content, null);
  if (packages) selection.packages = packages;
  return selection;
}

/**
 * A selection reduced to what the content actually offers: every mark and class
 * id appears once, as a real boolean, and anything else a caller sent is dropped.
 * Used on the way into `accepted_selection` so a hand-built request cannot stash
 * arbitrary keys in the firm's record.
 *
 * A fixed offer (`isFixedOffer`) has no choice in it, so whatever was sent it
 * normalizes to its one mark and one class ticked: the server is the authority,
 * and an empty or odd body from the client can't turn it into "nothing selected".
 */
export function normalizeSelection(content: ProposalContent, raw: unknown): Selection {
  if (isFixedOffer(content)) return fixedOfferSelection(content);
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
  // Spec 6: a package pick survives only as one of that name's own options; anything else is the default.
  const packages = resolvedPackagePicks(content, { packages: obj(given.packages) as PackagePicks });
  if (packages) selection.packages = packages;
  return selection;
}

function hasStringId(value: unknown): boolean {
  return typeof obj(value).id === "string" && (obj(value).id as string).length > 0;
}

/**
 * A "fixed offer" leaves the client nothing to choose: exactly one brand name
 * with exactly one mark and exactly one class (an Essential package, word mark
 * only, one class). The page shows it as written, with no checkboxes, and it is
 * always priced and accepted fully selected, whatever `preselected` says.
 * Anything malformed (no names array, a mark or class without an id) is not
 * fixed and keeps the ordinary checkboxes. Neither is a brand name with an open
 * class (`client_entry`) or `client_add` room: the client has something to write.
 */
export function isFixedOffer(content: ProposalContent): boolean {
  const names = arr<unknown>(content?.names);
  if (names.length !== 1) return false;
  const nm = obj(names[0]);
  const marks = arr<unknown>(nm.marks);
  const classes = arr<unknown>(nm.classes);
  // Spec 3: a class the client describes, or room to add classes, IS a choice, so it is never a fixed offer.
  // Only an EXPLICIT max above 0 counts here; an absent `client_add` is the firm saying nothing, and its default
  // (`clientAddMax`: 5, or 0 on a fixed offer) is worked out from this function, never fed into it.
  const addMax = obj(nm.client_add).max;
  if (typeof addMax === "number" && Number.isInteger(addMax) && addMax > 0) return false;
  if (classes.some((c) => obj(c).client_entry === true)) return false;
  // Spec 6: a package to pick is a choice too.
  if (packageChoiceOptions(content, nm).length > 0) return false;
  return marks.length === 1 && classes.length === 1 && hasStringId(marks[0]) && hasStringId(classes[0]);
}

/** A fixed offer's only selection: its one mark and one class ticked. Call only when `isFixedOffer`. */
function fixedOfferSelection(content: ProposalContent): Selection {
  const nm = content.names[0];
  return { [nm.marks[0].id]: true, [nm.classes[0].id]: true };
}

/** True when the quote has at least one brand name in it (something to accept). */
export function quoteHasItems(quote: ProposalQuote): boolean {
  return quote.names.some((n) => n.included);
}

/**
 * The legal fee for ONE mark of a package with `classCount` classes, worked out by `quoteProposal` itself over a
 * one-brand, one-mark stand-in. For words like "one class costs $X under the custom package"; nothing here prices on its own.
 */
export function priceForClassCount(pricing: ProposalPricing, classCount: number): number {
  const classes = Array.from({ length: Math.max(0, Math.floor(classCount)) }, (_, i) => ({ id: `c${i}`, label: `Class ${i + 1}`, preselected: true }));
  const content = {
    client: { first_name: "", full_name: "" },
    greeting: "",
    pricing,
    names: [{ id: "n", name: "n", marks: [{ id: "m", kind: "word" as const, desc: "", preselected: true }], classes }],
    adjustments: [],
    includes: [],
  } as ProposalContent;
  return quoteProposal(content, defaultSelection(content)).legal_total_cents;
}

/**
 * The firm never wants a client to untick their way to an empty proposal ($0,
 * nothing to accept). True when unticking `id` would take a quote that HAS
 * something in it (`quoteHasItems`) to one that has nothing. The rule is the
 * WHOLE proposal: a second brand name's boxes stay free while another brand
 * name is still buyable (a mark and a class). A selection that is already empty
 * (nothing preselected) locks nothing, so the client can always tick their way
 * in. Ticking is never refused; an id that isn't ticked is never "locked".
 */
export function wouldEmptyQuote(content: ProposalContent, selection: Selection, id: string): boolean {
  if (selection == null || selection[id] !== true) return false;
  if (!quoteHasItems(quoteProposal(content, selection))) return false;
  return !quoteHasItems(quoteProposal(content, { ...selection, [id]: false }));
}

/** Every mark and class id the client may not untick right now (see `wouldEmptyQuote`). */
export function lockedSelectionIds(content: ProposalContent, selection: Selection): Set<string> {
  const locked = new Set<string>();
  for (const nm of arr<ProposalContent["names"][number]>(content?.names)) {
    const ids = [
      ...arr<ProposalContent["names"][number]["marks"][number]>(nm?.marks).map((m) => m?.id),
      ...arr<ProposalContent["names"][number]["classes"][number]>(nm?.classes).map((c) => c?.id),
    ];
    for (const id of ids) {
      if (typeof id === "string" && wouldEmptyQuote(content, selection, id)) locked.add(id);
    }
  }
  return locked;
}
