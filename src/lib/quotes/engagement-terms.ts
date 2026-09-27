import {
  isLineSelected,
  lineAmountCents,
  quoteTotals,
  fullProjectCost,
  DEFAULT_CURRENCY,
  type QuoteLineInput,
} from "./pricing";
import { formatQuoteExpiry } from "./status";
import { offeredLines, readOffer } from "./packages";

/**
 * The engagement letter, as text, generated from THE SAME FIGURES the quote is
 * priced with.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `crm_quote.terms_body` is described by 0068 as "the fee-agreement language
 * the client is agreeing to", and `accepted_snapshot.quote.terms_body` already
 * freezes it at signature. So the signing machinery for an engagement letter
 * was already in place; what was missing was the language. Before this module
 * the column was free text a staff member typed from scratch, which meant the
 * one document stating what the client owes was written independently of the
 * lines stating what the client owes — two sources for one number is how a fee
 * agreement ends up contradicting the proposal it is stapled to.
 *
 * Everything below is derived from the quote's own lines. Nothing is looked up
 * elsewhere, and nothing is invented.
 *
 * ── NO MODEL WRITES A FEE TERM. EVER. ───────────────────────────────────────
 * `src/lib/documents/loe.ts` states the firm's hard rule: "every dollar amount
 * comes verbatim from the proposal... never fill a gap with a plausible
 * number", and enforces it by doing arithmetic only on numbers a human typed
 * and by showing that arithmetic rather than hiding it. This module keeps both
 * properties and is deliberately AI-free — there is no `askClaude` import here
 * and there must never be one. A model that writes "a 50% deposit is due on
 * execution" into a document a client then signs has invented a term of a legal
 * contract, and the client's signature would make it real. Where a figure is
 * missing, this emits a visible `[bracketed]` instruction to staff, exactly as
 * `buildGeneralLoeDraft` does — a gap a human must close, never a guess.
 *
 * ── THE TWO-FIGURE DISCIPLINE, RESTATED IN PROSE ────────────────────────────
 * "the USPTO fees are something separate that gets charged when we do the
 *  filing, not before or during signing the engagement letter." — Taylor,
 *  2026-09-09 (spec §0)
 *
 * `pricing.ts` refuses to export a `total` so that no surface can quietly
 * present one; this module must not put one back in words either. It states
 * two timed amounts and, where it names their sum, calls it the full project
 * cost and says it is not due at signing.
 *
 * ── PURE, AND CLIENT-SAFE ───────────────────────────────────────────────────
 * No `server-only`, no database, no clock beyond what the caller passes in.
 * The dashboard generates the text server-side and stores it; the same function
 * can preview it in a browser without a second implementation drifting from
 * this one — the mistake `PublicQuoteView.linesFingerprint` avoids by being
 * computed on the server only.
 */

/**
 * The USPTO's per-class filing fee, in cents.
 *
 * `documents/loe.ts` hard-codes the dollar form of the same number for the LOE
 * fee chart. It is duplicated rather than imported because that module is
 * `server-only` (it imports the AI client for the general-LOE flow) and this
 * one must stay importable from a client component. Both are the same published
 * government fee; if it changes, both change.
 *
 * It is used ONLY to explain the arithmetic in words. It never overrides a
 * staff-entered amount: if the firm typed something else on a `government_fee`
 * line, THAT is the number the client is quoted and THAT is the number printed
 * here. A generator that "corrected" a staff figure to its own constant would
 * be inventing a fee, which is the failure the SOP's hard rule exists to stop.
 */
export const GOV_FILING_FEE_PER_CLASS_CENTS = 35_000;

export type EngagementTermsInput = {
  /** The firm the client is contracting with. Rendered verbatim. */
  firmName: string;
  /** Staff-entered. Never derived from a lead record without a human seeing it
   * — the party to an agreement is not a field to guess. */
  clientName: string;
  /** The signing entity, when the client is signing as one. Null means the
   * individual named above is the client. */
  entityName?: string | null;
  /** The mark, when this is a trademark engagement. Null omits the scope line
   * entirely rather than printing an empty one. */
  markText?: string | null;
  /** The quote's lines, exactly as priced. The single source of every figure
   * below. */
  lines: readonly QuoteLineInput[];
  currency?: string;
  /**
   * `crm_quote.expires_at`, verbatim.
   *
   * `loe.ts` states a signature deadline of send date + 14 days, and this
   * module deliberately does NOT recompute that: the quote already carries an
   * expiry, and it is the one the accept path actually enforces (it is inside
   * the conditional UPDATE's own predicate). Terms that named a different date
   * from the one the link dies on would be prose contradicting the code —
   * which is the whole class of defect this module exists to remove. Absent
   * means the agreement says nothing about a deadline, because there isn't one.
   */
  expiresAt?: string | null;
};

/**
 * Cents → "$1,050.00", for this module only.
 *
 * `pricing.ts` ships no formatter on purpose (its header: formatting "belongs
 * to the rendering slice"), and the two app slices each carry their own
 * two-line copy for the same reason. This module RENDERS — it produces the text
 * of a document — so it owns one too. Nothing here is ever parsed back into a
 * number.
 */
function money(cents: number, currency: string): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe / 100);
  } catch {
    return `${(safe / 100).toFixed(2)} ${currency}`;
  }
}

/** The class count a `government_fee` line encodes.
 *
 * `quantity` on a government-fee line IS the number of classes — that is the
 * convention the firm's own fee chart uses ("$350 × 2 classes"), and it is what
 * `applyServiceItem` writes. Read through `lineAmountCents` rather than
 * `Number(...)` so a quantity that arrived as a quoted numeral (int8 over
 * PostgREST) counts the same as one that arrived as a number — the same
 * wire-tolerance `buildAcceptedSnapshot` uses for exactly this reason. */
function classCountOf(line: QuoteLineInput): number {
  return lineAmountCents({ quantity: line.quantity, unit_amount_cents: 1 });
}

/**
 * The government-fee paragraph, with the arithmetic on the page.
 *
 * One line per `government_fee` line the client is actually buying, each shown
 * as `unit × classes = amount` so a client (or a bar auditor) can check the
 * total without trusting us to have multiplied correctly. A firm that has
 * absorbed the fee (`charge_at: 'not_charged'`) is stated as absorbed rather
 * than silently dropped — "we are not charging you $350" is a term of the
 * agreement, and a client who never sees it cannot hold the firm to it.
 */
function governmentFeeLines(lines: readonly QuoteLineInput[], currency: string): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind !== "government_fee") continue;
    if (!isLineSelected(line)) continue;
    const classes = classCountOf(line);
    const unit = lineAmountCents({ quantity: 1, unit_amount_cents: line.unit_amount_cents });
    const amount = lineAmountCents(line);
    const label = (line.label ?? "").trim() || "USPTO filing fee";
    const math = `${money(unit, currency)} × ${classes} ${classes === 1 ? "class" : "classes"} = ${money(amount, currency)}`;
    out.push(
      line.charge_at === "not_charged"
        ? `- ${label}: ${math} — absorbed by the firm. You are not billed for this.`
        : `- ${label}: ${math}, charged when the application is filed.`,
    );
  }
  return out;
}

/** The fee lines the client pays at signing, itemised. Discounts included with
 * their sign, because a discount the client was shown and then cannot find in
 * the agreement reads as one that was withdrawn. */
function signingFeeLines(lines: readonly QuoteLineInput[], currency: string): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!isLineSelected(line)) continue;
    if (line.kind === "government_fee") continue;
    if (line.charge_at !== "signing") continue;
    const label = (line.label ?? "").trim() || "Legal fee";
    out.push(`- ${label}: ${money(lineAmountCents(line), currency)}`);
  }
  return out;
}

/**
 * Build the engagement terms.
 *
 * Returns plain text. `/q/[token]` renders it with `white-space: pre-wrap` and
 * never as HTML — that route has no sanitiser and no login in front of it, so
 * text that cannot execute beats rich text. Markdown-ish bullets are for the
 * eye only; nothing parses them.
 */
export function buildEngagementTerms(input: EngagementTermsInput): string {
  const currency = input.currency || DEFAULT_CURRENCY;
  // THE OFFER, not the worksheet: a package or add-on the firm switched off is
  // not part of what the client is signing (packages.ts).
  const lines = offeredLines(input.lines);
  const offer = readOffer(lines, currency);
  const totals = quoteTotals(lines, currency);
  const client = (input.entityName ?? "").trim() || input.clientName.trim();
  const mark = (input.markText ?? "").trim();

  // The same string `/q/[token]` prints above the proposal, from the same
  // function, so the header and the agreement cannot name two different days —
  // and in the firm's time zone, never the server's (see `formatQuoteExpiry`).
  const deadline = formatQuoteExpiry(input.expiresAt ?? null);

  const govLines = governmentFeeLines(lines, currency);
  const signingLines = signingFeeLines(lines, currency);

  const sections: string[] = [];

  sections.push(
    `ENGAGEMENT TERMS

This agreement is between ${input.firmName} ("the Firm") and ${client || "[client name — fill in before sending]"} ("you"). Signing below engages the Firm on the terms set out here and at the fees itemised in this proposal.`,
  );

  if (mark) {
    sections.push(`SCOPE

The Firm will represent you in connection with the mark ${mark}, performing the services itemised above and nothing beyond them. Work outside that scope is quoted separately and is not covered by the fees below.`);
  } else {
    sections.push(`SCOPE

The Firm will perform the services itemised above and nothing beyond them. Work outside that scope is quoted separately and is not covered by the fees below.`);
  }

  // ── FEES: the two timed figures, in the same order and with the same names
  // the totals panel above them uses. A client reading the agreement and the
  // panel must never be able to find two different answers to "what do I pay
  // today?".
  //
  // A quote the client makes CHOICES on (packages, add-ons) has no one pair of
  // figures until they choose, so each package is stated in full — its own two
  // figures, itemised — and each add-on with its price. The client's pick is
  // frozen with their signature beside the amounts it selects.
  sections.push(`FEES

${
  offer.packages.length > 0 || offer.addOns.length > 0
    ? choiceFees(offer, currency)
    : singleOfferFees(totals, signingLines, govLines, currency)
}`);

  // ── The §0 sentence, stated as a TERM and not only as a caption. The panel
  // above says it in a caption a client may skim; the thing they sign has to
  // say it too, because "I was told the government fees were included" is the
  // dispute this paragraph exists to prevent.
  sections.push(`WHEN THE USPTO FEES ARE CHARGED

United States Patent and Trademark Office filing fees are government charges, not the Firm's fees. They are charged when your application is filed — not at signing and not before. Nothing on this page charges a card: the amount due at signing is invoiced by the Firm after you sign.`);

  if (totals.notCharged !== 0) {
    sections.push(`NOT CHARGED

${money(totals.notCharged, currency)} of the items listed on this proposal is shown for transparency and is not billed to you.`);
  }

  sections.push(`FLAT FEES

The Firm's fees on this engagement are flat fees for the services itemised above. They are not hourly, and they are not a percentage of anything. Government fees are passed through at cost.`);

  sections.push(`ACCEPTANCE

Typing your name signs this agreement. Your name, email address, IP address and browser are recorded with your signature as the signing record, and a copy of the agreement exactly as you signed it is kept on the Firm's file.${
    deadline ? ` This proposal is open for signature until ${deadline}.` : ""
  }`);

  return sections.join("\n\n");
}

/** The FEES body for a quote the client makes no choice on: two timed figures,
 * itemised, and the project cost below them. */
function singleOfferFees(
  totals: ReturnType<typeof quoteTotals>,
  signingLines: string[],
  govLines: string[],
  currency: string,
): string {
  const feeBody: string[] = [
    `Due at signing: ${money(totals.dueAtSigning, currency)}`,
    signingLines.length ? signingLines.join("\n") : "- [no fee lines are marked due at signing — check the proposal before sending]",
    "",
    `Due later, at filing: ${money(totals.dueAtFiling, currency)}`,
  ];

  if (govLines.length) {
    feeBody.push(govLines.join("\n"));
  } else if (totals.dueAtFiling !== 0) {
    feeBody.push("- [an amount is due at filing but no government-fee line explains it — check the proposal before sending]");
  } else {
    feeBody.push("- No government filing fees are payable on this engagement.");
  }

  feeBody.push(
    "",
    `Full project cost: ${money(fullProjectCost(totals), currency)}. That is the two amounts above added together; it is not an amount due at signing.`,
  );
  return feeBody.join("\n");
}

/**
 * The FEES body for a quote with packages or add-ons: every package with its
 * own two timed figures and the lines behind them, then the add-ons. Every
 * figure is a sum of the lines, through the same helpers as the single-offer
 * body, and the sum of the two is again named "full project cost" and said not
 * to be due at signing.
 */
function choiceFees(offer: ReturnType<typeof readOffer>, currency: string): string {
  const out: string[] = [];
  if (offer.packages.length > 0) {
    out.push("You choose one package on this page. What is due, and when, depends on that choice:");
    for (const pkg of offer.packages) {
      const chosen = [...offer.common, ...pkg.lines.map((line) => ({ ...line, selected: true }))];
      const signing = signingFeeLines(chosen, currency);
      const gov = governmentFeeLines(chosen, currency);
      out.push(
        "",
        pkg.name.toUpperCase(),
        `Due at signing: ${money(pkg.totals.dueAtSigning, currency)}`,
        signing.length ? signing.join("\n") : "- [no fee lines in this package are marked due at signing — check the proposal before sending]",
        `Due later, at filing: ${money(pkg.totals.dueAtFiling, currency)}`,
        gov.length
          ? gov.join("\n")
          : pkg.totals.dueAtFiling !== 0
            ? "- [an amount is due at filing but no government-fee line explains it — check the proposal before sending]"
            : "- No government filing fees are payable with this package.",
        `Full project cost for this package: ${money(fullProjectCost(pkg.totals), currency)}. That is the two amounts above added together; it is not an amount due at signing.`,
      );
    }
  } else {
    const base = offer.commonTotals;
    out.push(
      `Due at signing: ${money(base.dueAtSigning, currency)}`,
      signingFeeLines(offer.common, currency).join("\n") || "- [no fee lines are marked due at signing — check the proposal before sending]",
      "",
      `Due later, at filing: ${money(base.dueAtFiling, currency)}`,
      governmentFeeLines(offer.common, currency).join("\n") || "- No government filing fees are payable on this engagement.",
    );
  }

  if (offer.addOns.length > 0) {
    out.push("", "OPTIONAL ADD-ONS", "Charged only if you choose them on this page:");
    for (const { line } of offer.addOns) {
      const label = (line.label ?? "").trim() || "Add-on";
      const when = line.kind === "government_fee" || line.charge_at === "filing" ? "at filing" : line.charge_at === "not_charged" ? "not charged" : "at signing";
      out.push(`- ${label}: ${money(lineAmountCents({ ...line, selected: true }), currency)}, ${when}`);
    }
  }

  out.push(
    "",
    "The package and any add-ons you choose are recorded with your signature, and the amounts that apply to you are the ones stated for them here.",
  );
  return out.join("\n");
}
