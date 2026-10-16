import {
  DEFAULT_CURRENCY,
  chargeBucket,
  fullProjectCost,
  lineAmountCents,
  quoteBlockers,
  quoteTotals,
  type QuoteBlockReason,
  type QuoteLineInput,
  type QuoteTotals,
} from "./pricing";

/**
 * Packages, add-ons and the firm's OFFER: how the quote builder in
 * design/Quote_Builder_Prototype.dc.html maps onto `crm_quote_line`, with no
 * schema change.
 *
 * Pure module: no database, no server-only imports, no clock. Safe from a
 * `"use client"` component and from a plain vitest run.
 *
 * ── THE MAPPING ─────────────────────────────────────────────────────────────
 *   `included`    → IN EVERY PACKAGE. Always part of what the client buys.
 *   `tier_option` → a PACKAGE's line. `tier_group` is the package's name; every
 *                   line carrying that name belongs to it, government fees
 *                   included. The client picks ONE package and takes all of
 *                   its lines (pricing.ts's `quoteBlockers` holds that rule).
 *   `optional`    → an ADD-ON the client may tick.
 *
 * ── WHAT `selected` MEANS, BEFORE AND AFTER SIGNATURE ───────────────────────
 * The design gives every package and add-on an "offer" switch, and 0068 has no
 * column for it. The one boolean a line has is `selected`, so:
 *
 *  - Until the quote is accepted, `selected` on a `tier_option` / `optional`
 *    line is the FIRM's switch: true = offered to the client, false = kept on
 *    the worksheet but withheld. Withheld lines never leave the server
 *    (`offeredLines` is what `/q/<token>` publishes).
 *  - The client's pick is NOT written to the rows while they read. It travels
 *    with the signature, is validated against the offer (`applyClientChoice`),
 *    and is frozen into `accepted_snapshot`, whose lines say `selected` = what
 *    the client took. The winning acceptance then writes that choice back to
 *    the rows, so an accepted quote's rows read as the client's choice again —
 *    which is the meaning 0068's column comment gives it.
 *  - `included` lines are always `selected` (0068's
 *    `crm_quote_line_included_selected`), before and after.
 *
 * A package's switch is stored on every one of its lines, and the store writes
 * them together. A package whose lines disagree is MIXED: it is treated as not
 * offered — a client is never shown half a package — and the builder says so.
 *
 * ── THE PACKAGE BLURB IS DERIVED, NOT STORED ────────────────────────────────
 * There is no column for it either. `packageBlurb` lists what the package's own
 * lines are, so the description a client reads can never promise something the
 * priced lines do not contain. Prose about the engagement belongs in the
 * quote's intro.
 */

/* ─────────────────────────────── the offer ─────────────────────────────── */

export type QuotePackage<L extends QuoteLineInput = QuoteLineInput> = {
  /** `tier_group`, trimmed. Also the package's display name. */
  name: string;
  /** The package's own lines, in the caller's (sort) order. */
  lines: L[];
  /** Every line switched on. */
  offered: boolean;
  /** Some lines on and some off — never shown to a client, flagged to the firm. */
  mixed: boolean;
  /** What choosing this package costs: its lines plus every `included` line.
   * Add-ons are the client's to add. */
  totals: QuoteTotals;
};

export type QuoteAddOn<L extends QuoteLineInput = QuoteLineInput> = {
  line: L;
  offered: boolean;
};

export type QuoteOffer<L extends QuoteLineInput = QuoteLineInput> = {
  /** `included` lines: part of every package. */
  common: L[];
  /** Packages in first-appearance order. */
  packages: QuotePackage<L>[];
  addOns: QuoteAddOn<L>[];
  /** Totals of the `included` lines alone — the whole price of a quote with no
   * packages. */
  commonTotals: QuoteTotals;
  /** Lines this build cannot place: a `selection` it does not recognise, or a
   * `tier_option` with no group. Never offered; `offerProblems` reports them. */
  unplaced: L[];
};

function selectionOf(line: QuoteLineInput): string {
  const raw = line.selection;
  if (typeof raw !== "string" || !raw.trim()) return "included";
  return raw.trim();
}

function packageKey(line: QuoteLineInput): string {
  return typeof line.tier_group === "string" ? line.tier_group.trim() : "";
}

/** The package's lines as if chosen, plus the common lines. */
function packageProjection<L extends QuoteLineInput>(common: readonly L[], lines: readonly L[]): L[] {
  return [...common, ...lines.map((line) => ({ ...line, selected: true }))];
}

export function readOffer<L extends QuoteLineInput>(
  lines: readonly L[],
  currency: string = DEFAULT_CURRENCY,
): QuoteOffer<L> {
  const common: L[] = [];
  const addOns: QuoteAddOn<L>[] = [];
  const unplaced: L[] = [];
  const byName = new Map<string, L[]>();

  for (const line of lines) {
    const selection = selectionOf(line);
    if (selection === "included") common.push(line);
    else if (selection === "optional") addOns.push({ line, offered: line.selected === true });
    else if (selection === "tier_option" && packageKey(line)) {
      const key = packageKey(line);
      const list = byName.get(key) ?? [];
      list.push(line);
      byName.set(key, list);
    } else unplaced.push(line);
  }

  const packages: QuotePackage<L>[] = Array.from(byName.entries()).map(([name, pkgLines]) => {
    const on = pkgLines.filter((line) => line.selected === true).length;
    return {
      name,
      lines: pkgLines,
      offered: on === pkgLines.length,
      mixed: on > 0 && on < pkgLines.length,
      totals: quoteTotals(packageProjection(common, pkgLines), currency),
    };
  });

  return { common, packages, addOns, commonTotals: quoteTotals(common, currency), unplaced };
}

/**
 * The lines a client is shown: every `included` line, every line of every
 * OFFERED package, every OFFERED add-on — in the caller's order. Withheld and
 * unplaced lines are not in the result, so they never reach the browser.
 */
export function offeredLines<L extends QuoteLineInput>(lines: readonly L[]): L[] {
  const offer = readOffer(lines);
  const keep = new Set<L>([
    ...offer.common,
    ...offer.packages.filter((pkg) => pkg.offered).flatMap((pkg) => pkg.lines),
    ...offer.addOns.filter((addOn) => addOn.offered).map((addOn) => addOn.line),
  ]);
  return lines.filter((line) => keep.has(line));
}

/* ───────────────────────── problems with the offer ─────────────────────── */

export type OfferProblemReason =
  | "no_lines"
  /** The quote has packages and every one is switched off. */
  | "no_package_offered"
  /** Some of a package's lines are on and some off. */
  | "package_mixed"
  /** A line this build cannot place (unknown selection, or no package name). */
  | "unplaced_line"
  /** One of pricing.ts's integrity problems, on some choice the client can make. */
  | QuoteBlockReason;

export type OfferProblem = {
  reason: OfferProblemReason;
  message: string;
  /** Problems that stop the quote being SENT. The rest are warnings the
   * accept path enforces on its own. */
  blocksSending: boolean;
  packageName?: string;
  lineId?: string;
};

/** Pricing's choice-related reasons: about what the CLIENT picks, not about the
 * firm's offer, so they never belong on the builder's problem list. */
const CHOICE_REASONS = new Set<string>(["tier_group_unselected", "tier_group_multiple", "tier_group_partial", "no_lines"]);

/**
 * Everything wrong with the offer as the firm has built it, for the builder
 * and for Send.
 *
 * Integrity problems (a USPTO fee at signing, an unreadable amount, discounts
 * that exceed the fees) are checked against every choice the client can
 * actually make — each offered package with the common lines — because a
 * problem that only shows once the client picks "Filing only" is still a
 * problem on this quote.
 */
export function offerProblems(lines: readonly QuoteLineInput[]): OfferProblem[] {
  if (lines.length === 0) {
    return [{ reason: "no_lines", message: "Add at least one line before sending.", blocksSending: true }];
  }
  const offer = readOffer(lines);
  const out: OfferProblem[] = [];

  if (offer.packages.length > 0 && !offer.packages.some((pkg) => pkg.offered)) {
    out.push({
      reason: "no_package_offered",
      message: "At least one package has to be offered.",
      blocksSending: true,
    });
  }
  for (const pkg of offer.packages) {
    if (pkg.mixed) {
      out.push({
        reason: "package_mixed",
        message: `Some lines in “${pkg.name}” are switched off, so the client won't see it. Switch the package off and on again.`,
        blocksSending: true,
        packageName: pkg.name,
      });
    }
  }
  for (const line of offer.unplaced) {
    out.push({
      reason: "unplaced_line",
      message: "A line isn't in a package, an add-on or every package. Remove it and add it again.",
      blocksSending: true,
      lineId: line.id ?? undefined,
    });
  }

  const choices = offer.packages.some((pkg) => pkg.offered)
    ? offer.packages.filter((pkg) => pkg.offered).map((pkg) => packageProjection(offer.common, pkg.lines))
    : [offer.common];
  const seen = new Set<string>();
  for (const choice of choices) {
    for (const blocker of quoteBlockers(choice)) {
      if (CHOICE_REASONS.has(blocker.reason)) continue;
      const key = `${blocker.reason}:${blocker.lineId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ reason: blocker.reason, message: blocker.message, blocksSending: false, lineId: blocker.lineId });
    }
  }
  return out;
}

/**
 * Whether a client may sign this offer at all, judged over EVERY line the
 * quote has (withheld ones included) — so it is computed on the server and
 * only its answer travels.
 *
 * False when packages exist and none is offered (the client would otherwise be
 * shown the common lines as if they were the whole deal), or when a line
 * exists that this build cannot place.
 */
export function isOfferIntact(lines: readonly QuoteLineInput[]): boolean {
  const offer = readOffer(lines);
  if (offer.unplaced.length > 0) return false;
  if (offer.packages.length > 0 && !offer.packages.some((pkg) => pkg.offered)) return false;
  return true;
}

/* ───────────────────────────── the client's pick ───────────────────────── */

/** What a client chooses on `/q/<token>`: one package (by name) and any add-ons. */
export type ClientChoice = {
  /** A package name, or null when the quote has no packages (or none picked yet). */
  package: string | null;
  /** Ids of `optional` lines. */
  addOns: readonly string[];
};

export type ChoiceRefusal =
  /** A package name that is not one of the offered packages. */
  | "unknown_package"
  /** An id that is not one of the offered add-ons. */
  | "unknown_add_on";

/** A posted choice, read defensively: it arrives at an unauthenticated POST. */
export function readClientChoice(value: unknown): ClientChoice {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pkg = typeof raw.package === "string" && raw.package.trim() ? raw.package.trim() : null;
  const addOns = Array.isArray(raw.addOns) ? raw.addOns.filter((id): id is string => typeof id === "string") : [];
  return { package: pkg, addOns: addOns.slice(0, 200) };
}

/**
 * Project the client's pick onto the lines they were shown: the chosen
 * package's lines and ticked add-ons `selected`, everything else not.
 *
 * `offered` must be the client-visible set (`offeredLines`). A name or id that
 * is not in it is REFUSED, never dropped: a client whose page was built from
 * an older offer must reload and look, not sign a different selection from the
 * one they made.
 *
 * Whether a package is chosen at all is `quoteReadiness`'s question, asked of
 * the result — "Choose a package." is an instruction to the client, not a
 * malformed request.
 */
export function applyClientChoice<L extends QuoteLineInput>(
  offered: readonly L[],
  choice: ClientChoice,
): { ok: true; lines: L[] } | { ok: false; reason: ChoiceRefusal } {
  const offer = readOffer(offered);
  const packageNames = new Set(offer.packages.map((pkg) => pkg.name));
  if (choice.package !== null && !packageNames.has(choice.package)) {
    return { ok: false, reason: "unknown_package" };
  }
  const addOnIds = new Set(offer.addOns.map((addOn) => addOn.line.id));
  const chosen = new Set<string>();
  for (const id of choice.addOns) {
    if (!addOnIds.has(id)) return { ok: false, reason: "unknown_add_on" };
    chosen.add(id);
  }

  const lines = offered.map((line) => {
    const selection = selectionOf(line);
    if (selection === "tier_option") return { ...line, selected: packageKey(line) === choice.package };
    if (selection === "optional") return { ...line, selected: typeof line.id === "string" && chosen.has(line.id) };
    return line;
  });
  return { ok: true, lines };
}

/* ─────────────────────────────── display ───────────────────────────────── */

/** Package names are free text (0068 keeps them the firm's own), bounded. */
export const PACKAGE_NAME_MAX = 120;

/** A usable package name, or null: trimmed, inner whitespace collapsed, 1-120 chars. */
export function normalizePackageName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= PACKAGE_NAME_MAX ? name : null;
}

/**
 * What a package contains, in the client's words: its lines' labels, fees
 * first. Government fees are left out — they are shown beside the price as the
 * separate amount due at filing, which is the one thing about them a client
 * must not miss.
 */
export function packageBlurb(lines: readonly QuoteLineInput[]): string {
  return lines
    .filter((line) => line.kind !== "government_fee")
    .map((line) => (line.label ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

/** A line of the signed record, in the order the client agreed to it. */
export type SignedChoiceLine = {
  id: string;
  label: string;
  amountCents: number;
  quantity: number;
  bucket: "signing" | "filing" | "not_charged";
  isAddOn: boolean;
};

export type SignedChoice = {
  /** The package taken, or null for a quote with no packages. */
  packageName: string | null;
  /** Signing-side lines of the package and every-package lines, then the add-ons
   * taken, then what is due at filing, then what is never charged — the order
   * the design lists them in. */
  agreed: SignedChoiceLine[];
  /** Packages offered and not taken. */
  otherPackages: string[];
  /** Add-ons offered and not taken, by label. */
  declinedAddOns: string[];
};

type SnapshotLike = {
  id: string;
  label: string;
  kind: string;
  charge_at: string;
  selection: string;
  tier_group: string | null;
  selected: boolean;
  quantity: number | string;
  unit_amount_cents: number | string;
  amount_cents?: number | string;
};

function frozenAmount(line: SnapshotLike): number {
  const n = typeof line.amount_cents === "number" ? line.amount_cents : Number(line.amount_cents);
  return Number.isFinite(n) ? Math.trunc(n) : lineAmountCents(line);
}

/**
 * The signed record, read for display: which package was taken, and its lines
 * in the design's order. Every amount is the snapshot's own `amount_cents` —
 * nothing is re-priced.
 */
export function describeSignedChoice(lines: readonly SnapshotLike[]): SignedChoice {
  const taken = lines.filter((line) => line.selected);
  const packageName = taken.find((line) => line.selection === "tier_option")?.tier_group?.trim() || null;
  const toLine = (line: SnapshotLike): SignedChoiceLine => ({
    id: line.id,
    label: line.label,
    amountCents: frozenAmount(line),
    quantity: lineAmountCents({ quantity: line.quantity, unit_amount_cents: 1 }),
    bucket: chargeBucket(line),
    isAddOn: line.selection === "optional",
  });

  const base = taken.filter((line) => line.selection !== "optional").map(toLine);
  const addOns = taken.filter((line) => line.selection === "optional").map(toLine);
  const agreed = [
    ...base.filter((line) => line.bucket === "signing"),
    ...addOns.filter((line) => line.bucket === "signing"),
    ...base.filter((line) => line.bucket === "filing"),
    ...addOns.filter((line) => line.bucket === "filing"),
    ...[...base, ...addOns].filter((line) => line.bucket === "not_charged"),
  ];

  const otherPackages = Array.from(
    new Set(
      lines
        .filter((line) => line.selection === "tier_option" && !line.selected)
        .map((line) => (line.tier_group ?? "").trim())
        .filter((name) => name && name !== packageName),
    ),
  );
  const declinedAddOns = lines.filter((line) => line.selection === "optional" && !line.selected).map((line) => line.label);

  return { packageName, agreed, otherPackages, declinedAddOns };
}

/**
 * The figures a quote LIST shows for an unsigned quote. A quote with packages
 * has no single price until the client picks, so this is a range over the
 * offered packages (add-ons excluded — the client may not take them). An
 * accepted quote's figures come from its snapshot, never from here.
 */
export type OfferHeadline = {
  dueAtSigning: { low: number; high: number };
  fullProjectCost: { low: number; high: number };
  currency: string;
};

export function offerHeadline(lines: readonly QuoteLineInput[], currency: string = DEFAULT_CURRENCY): OfferHeadline {
  const offer = readOffer(lines, currency);
  const offered = offer.packages.filter((pkg) => pkg.offered);
  const totals = offered.length > 0 ? offered.map((pkg) => pkg.totals) : [offer.commonTotals];
  const signing = totals.map((t) => t.dueAtSigning);
  const project = totals.map((t) => fullProjectCost(t));
  return {
    dueAtSigning: { low: Math.min(...signing), high: Math.max(...signing) },
    fullProjectCost: { low: Math.min(...project), high: Math.max(...project) },
    currency: totals[0]?.currency ?? currency,
  };
}
