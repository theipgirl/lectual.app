import { markFromTerms } from "@/lib/quotes/accept-matter";
import { quoteReference } from "@/lib/quotes/labels";
import { centsToInput, formatCents, parseDollarsToCents } from "@/lib/quotes/money";
import { describeSignedChoice } from "@/lib/quotes/packages";
import { chargeBucket, isLineSelected, lineAmountCents, type QuoteChargeAt } from "@/lib/quotes/pricing";
import { FIRM_TIME_ZONE } from "@/lib/quotes/firm-time";
// Types only: `public.ts` is the accept path's module and stays out of this one's runtime graph.
import type { QuoteAcceptedSnapshot, QuoteAcceptedSnapshotLine } from "@/lib/quotes/public";
import { formatInternationalClasses } from "@/lib/matters/ip-fields";

/**
 * Pre-filling the engagement letter from the client's SIGNED quote.
 *
 * The Aug 29 intake SOP (section 2.4): "Staff open the Document Center LOE form,
 * now pre-filled — package, chart rows, class list, class count and amount all
 * carried over, nothing typed. Staff choose the current or legacy template — a
 * hard rule that is never guessed."
 *
 * ── WHAT THIS READS, AND WHAT IT NEVER READS ────────────────────────────────
 * Only `crm_quote.accepted_snapshot`: the record frozen at signature (quotes/
 * public.ts, spec §5). Every figure below is that record's own `amount_cents` or
 * `totals`, never `quantity × unit_amount_cents` over the quote's CURRENT lines.
 * The live lines can be edited after signing (the quote page shows that as
 * "drift"); the letter must say what the client signed, so this function does
 * not take the live lines at all. It cannot re-price.
 *
 * The snapshot does not carry class numbers or goods/services — the quote engine
 * has no such field, and its terms text names one mark. So the mark comes from
 * the signed terms (else the matter), and class numbers and goods come from the
 * matter's own file, where staff already see them. Each field the quote cannot
 * answer is left empty and listed in `checks`; nothing is guessed.
 *
 * ── WHAT IT NEVER CHOOSES ───────────────────────────────────────────────────
 * The current-vs-legacy template. The result has no field for it.
 *
 * ── PURE ────────────────────────────────────────────────────────────────────
 * No database, no clock. Every value is a string because that is what a form
 * field holds; the same shapes are serialised from the server page into the
 * client form.
 */

/** The matter facts that fill what the quote does not carry. */
export type LoeMatterFacts = {
  mark_text: string | null;
  international_classes: number[] | null;
  goods_services: string | null;
  package_name: string | null;
};

export type LoePrefill = {
  quoteId: string;
  /** "QT-3F9A1C" — the quote page's own reference, uppercased. */
  reference: string;
  /** "Sep 27, 2026" in the firm's zone, or "" when the instant is unreadable. */
  acceptedOn: string;
  signerName: string | null;

  // Trademark LOE fields.
  packageName: string;
  markText: string;
  /** Where the mark text came from, so the label can say so. */
  markFrom: "signed terms" | "matter" | null;
  classCount: string;
  classSelected: string;
  amountPaid: string;
  amountPaidMath: string;
  /** The chosen package's rows, one per line, from the signed lines. */
  benefitRowsText: string;
  /** The "Government Filing Fees" value, from the signed government-fee lines. */
  govFeesText: string;

  // General LOE fields.
  scopeDescription: string;
  feeStructure: string;
  /** Dollars as a plain decimal ("2525.00"), or "" when nothing was due. */
  quotedAmount: string;

  /** The frozen totals, formatted, for the banner above the form. */
  totals: { dueAtSigning: string; dueAtFiling: string; fullProjectCost: string };
  /** Things a person should look at before generating. Empty means none. */
  checks: string[];
};

/* ───────────────────────────── small helpers ───────────────────────────── */

/** "$2,525" — whole dollars lose the ".00", cents are kept. */
function dollars(cents: number, currency: string): string {
  const text = formatCents(cents, currency);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}

/** "350" / "350.50" — an amount without its symbol, for the "350 × 2 classes" math. */
function plainDollars(cents: number): string {
  const text = centsToInput(cents);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}

/** The snapshot's own line amount, falling back to the same arithmetic only when
 * the frozen one is unreadable (packages.ts does the same). */
function frozenAmountCents(line: QuoteAcceptedSnapshotLine): number {
  const n = typeof line.amount_cents === "number" ? line.amount_cents : Number(line.amount_cents);
  return Number.isFinite(n) ? Math.trunc(n) : lineAmountCents(line);
}

function frozenTotal(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** A quantity as a whole count of at least one, read as pricing.ts reads it. */
function countOf(line: QuoteAcceptedSnapshotLine): number {
  return lineAmountCents({ quantity: line.quantity, unit_amount_cents: 1 });
}

function unitCents(line: QuoteAcceptedSnapshotLine): number {
  return lineAmountCents({ quantity: 1, unit_amount_cents: line.unit_amount_cents });
}

/** "Sep 27, 2026" in the firm's zone; "" for anything that is not an instant. */
export function formatSignedOn(value: string | null | undefined, timeZone: string = FIRM_TIME_ZONE): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
  } catch {
    return "";
  }
}

const BUCKET_ORDER: Record<QuoteChargeAt, number> = { signing: 0, filing: 1, not_charged: 2 };

/* ─────────────────────────── class labels in goods ─────────────────────── */

/**
 * The class number(s) a line of goods text opens with: "Class 25:", "Class 25 —",
 * "Class 25 -", "Classes 25, 35:" or "25:", in any case. A bare number counts only
 * with its colon, so "24-hour fitness classes" stays goods text, not class 24.
 */
const LEADING_CLASS_LABEL = /^\s*(?:class(?:es)?\s*(\d{1,2}(?:\s*(?:,|&|and)\s*\d{1,2})*)(?!\d)|(\d{1,2})\s*:)/i;

function classesLabelledAtStart(line: string): number[] {
  const match = LEADING_CLASS_LABEL.exec(line);
  if (!match) return [];
  return (match[1] ?? match[2]).match(/\d+/g)?.map(Number) ?? [];
}

/**
 * Whether the goods text already names its classes itself, so a "Class 25 — "
 * prefix would only say it twice. That is so when the text opens with a class
 * label and every class the matter lists is labelled at the start of some line
 * (the matter's own "Class 25: …\nClass 35: …" shape). A matter class the goods
 * leave unlabelled keeps the prefix: the prefix is the only place that number
 * would appear in the letter.
 */
function goodsNameTheirClasses(goods: string, classes: readonly number[]): boolean {
  if (classes.length === 0) return false;
  const lines = goods.split(/\r?\n/);
  if (classesLabelledAtStart(lines[0]).length === 0) return false;
  const labelled = new Set(lines.flatMap(classesLabelledAtStart));
  return classes.every((n) => labelled.has(n));
}

/* ───────────────────────────── the chart rows ──────────────────────────── */

/** One chart row for a priced line, timed by when it is charged. */
function chartRow(line: QuoteAcceptedSnapshotLine, currency: string): string {
  const label = (line.label ?? "").trim() || "Line";
  const tag = line.selection === "optional" ? " (add-on)" : "";
  const bucket = chargeBucket(line);
  const amount = frozenAmountCents(line);
  const qty = countOf(line);
  const math =
    qty > 1 ? `${dollars(unitCents(line), currency)} × ${qty} = ${dollars(amount, currency)}` : dollars(amount, currency);
  if (bucket === "not_charged") {
    return amount === 0 ? `${label}${tag} — included` : `${label}${tag} — ${math} (not charged)`;
  }
  if (bucket === "filing") return `${label}${tag} — ${math} (due at filing)`;
  return `${label}${tag} — ${math}`;
}

/* ─────────────────────────── government fees ──────────────────────────── */

/**
 * The "Government Filing Fees" value, in the shape the generator has always
 * printed ("$700 (350 × 2 classes)"), but from the signed lines. A fee the firm
 * absorbed is stated as absorbed — it is a term the client signed — and is never
 * folded into an amount due.
 */
function govFeesText(govLines: QuoteAcceptedSnapshotLine[], currency: string): string {
  const describe = (lines: QuoteAcceptedSnapshotLine[]) => {
    const byUnit = new Map<number, number>();
    for (const line of lines) byUnit.set(unitCents(line), (byUnit.get(unitCents(line)) ?? 0) + countOf(line));
    const parts = [...byUnit.entries()].map(([unit, qty]) => `${plainDollars(unit)} × ${qty} ${qty === 1 ? "class" : "classes"}`);
    const total = lines.reduce((sum, line) => sum + frozenAmountCents(line), 0);
    return { total, math: parts.join(" + ") };
  };
  const charged = govLines.filter((line) => chargeBucket(line) !== "not_charged");
  const absorbed = govLines.filter((line) => chargeBucket(line) === "not_charged");
  const out: string[] = [];
  if (charged.length > 0) {
    const { total, math } = describe(charged);
    out.push(`${dollars(total, currency)} (${math})`);
  }
  if (absorbed.length > 0) {
    const { total, math } = describe(absorbed);
    out.push(`${dollars(0, currency)} — ${dollars(total, currency)} (${math}) absorbed by the firm, not charged`);
  }
  return out.join("; ");
}

/* ──────────────────────────── the builder ──────────────────────────────── */

/**
 * Builds every pre-filled field from one signed snapshot.
 *
 * `acceptedAt` is the quote row's own column, used only when the snapshot lacks
 * the instant. `timeZone` is the firm's (crm_org_profile), never the server's.
 */
export function buildLoePrefill(input: {
  quoteId: string;
  snapshot: QuoteAcceptedSnapshot;
  matter: LoeMatterFacts;
  acceptedAt?: string | null;
  timeZone?: string;
}): LoePrefill {
  const { snapshot, matter } = input;
  const currency = (snapshot.currency ?? "").trim() || "USD";
  const allLines: QuoteAcceptedSnapshotLine[] = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const taken = allLines.filter(isLineSelected);
  const checks: string[] = [];

  // ── the money: the snapshot's frozen totals ────────────────────────────────
  const signingTotal = frozenTotal(snapshot.totals?.due_at_signing);
  const filingTotal = frozenTotal(snapshot.totals?.due_at_filing);
  if (signingTotal === null || filingTotal === null) {
    // Never a silent "$0": a total that is not whole cents is a record to look at.
    checks.push("The signed copy's totals are not whole amounts in cents, so the amounts below read as $0. Check the quote and enter them.");
  }
  const dueAtSigning = signingTotal ?? 0;
  const dueAtFiling = filingTotal ?? 0;
  const fullProject = frozenTotal(snapshot.totals?.full_project_cost) ?? dueAtSigning + dueAtFiling;

  // The record is arithmetic-independent, but a frozen total that disagrees with
  // the frozen lines beside it is worth a human's eye before it goes in a letter.
  const signingFromLines = taken.reduce((sum, line) => (chargeBucket(line) === "signing" ? sum + frozenAmountCents(line) : sum), 0);
  if (signingFromLines !== dueAtSigning) {
    checks.push(
      `The signed copy's amount due at signing (${dollars(dueAtSigning, currency)}) does not equal its signing lines added up (${dollars(signingFromLines, currency)}). The letter uses the signed total; check the quote before sending.`,
    );
  }

  // ── government fees → class count ──────────────────────────────────────────
  const govLines = taken.filter((line) => line.kind === "government_fee");
  const quotedClassCount = govLines.reduce((sum, line) => sum + countOf(line), 0);
  const matterClasses = matter.international_classes ?? [];

  let classCount = quotedClassCount;
  if (govLines.length === 0) {
    if (matterClasses.length > 0) {
      classCount = matterClasses.length;
      checks.push(
        `The signed quote has no USPTO fee line, so the class count (${classCount}) is the number of classes on the matter's file, and the government fees are left for you to fill in.`,
      );
    } else {
      checks.push("The signed quote has no USPTO fee line, and the matter lists no classes. Enter the class count and the government fees.");
    }
  } else if (matterClasses.length > 0 && matterClasses.length !== quotedClassCount) {
    checks.push(
      `The signed quote charges USPTO fees for ${quotedClassCount} ${quotedClassCount === 1 ? "class" : "classes"}; the matter lists ${matterClasses.length} (${formatInternationalClasses(matterClasses)}). The letter uses the signed quote's count.`,
    );
  }

  // ── the amount, and the math behind a discount ─────────────────────────────
  const signingDiscounts = taken.filter((line) => line.kind === "discount" && chargeBucket(line) === "signing");
  const signingBase = taken
    .filter((line) => line.kind !== "discount" && chargeBucket(line) === "signing")
    .reduce((sum, line) => sum + frozenAmountCents(line), 0);
  const discountTotal = signingDiscounts.reduce((sum, line) => sum + frozenAmountCents(line), 0);
  let amountPaidMath = "";
  let discountsExplained = false;
  if (signingDiscounts.length > 0) {
    if (signingBase + discountTotal === dueAtSigning && signingDiscounts.every((line) => frozenAmountCents(line) <= 0)) {
      const subtractions = signingDiscounts.map((line) => ` − ${dollars(Math.abs(frozenAmountCents(line)), currency)}`).join("");
      amountPaidMath = `${dollars(signingBase, currency)}${subtractions} = ${dollars(dueAtSigning, currency)}`;
      discountsExplained = true;
    } else {
      checks.push("The signed quote has discount lines whose math does not add up to the signed amount, so the math is left blank and the discounts are listed in the rows instead.");
    }
  }

  // ── the rows: every other signed line, in the order the client agreed to it ─
  const rowLines = taken
    .filter((line) => line.kind !== "government_fee" && !(discountsExplained && line.kind === "discount" && chargeBucket(line) === "signing"))
    .map((line, index) => ({ line, index }))
    .sort((a, b) => BUCKET_ORDER[chargeBucket(a.line)] - BUCKET_ORDER[chargeBucket(b.line)] || a.index - b.index)
    .map(({ line }) => line);
  const benefitRowsText = rowLines.map((line) => chartRow(line, currency)).join("\n");

  // ── package ────────────────────────────────────────────────────────────────
  const quotedPackage = describeSignedChoice(allLines).packageName;
  const matterPackage = matter.package_name?.trim() || null;
  const packageName = quotedPackage ?? matterPackage ?? "";
  if (!quotedPackage) {
    checks.push(
      matterPackage
        ? "The signed quote has no package, so the package name is the one on the matter's file."
        : "The signed quote has no package and the matter has none on file. Enter the package name.",
    );
  }

  // ── the mark ───────────────────────────────────────────────────────────────
  const termsMark = markFromTerms(snapshot.quote?.terms_body ?? null);
  const matterMark = matter.mark_text?.trim() || null;
  const markText = termsMark ?? matterMark ?? "";
  const markFrom = termsMark ? "signed terms" : matterMark ? "matter" : null;
  if (termsMark && matterMark && termsMark.toLowerCase() !== matterMark.toLowerCase()) {
    checks.push(`The signed terms name the mark ${termsMark}; the matter's file says ${matterMark}. Check which one this letter is for.`);
  } else if (!markText) {
    checks.push("Neither the signed terms nor the matter name a mark. Enter it.");
  }

  // ── classes and goods: the matter's file ───────────────────────────────────
  const classList = formatInternationalClasses(matterClasses);
  const goods = matter.goods_services?.trim() || "";
  const classLabel = matterClasses.length === 1 ? "Class" : "Classes";
  // The goods text is verbatim. When it already opens with its own class label
  // ("Class 25: Clothing…") the label is not added a second time.
  const classSelected =
    classList && goods
      ? goodsNameTheirClasses(goods, matterClasses)
        ? goods
        : `${classLabel} ${classList} — ${goods}`
      : classList
        ? `${classLabel} ${classList}`
        : goods;
  if (!classList || !goods) {
    checks.push(
      !classList && !goods
        ? "The matter has no class numbers or goods/services on file, and the signed quote does not carry them. Enter the classes and goods."
        : !classList
          ? "The matter has goods/services but no class numbers on file. Add the class numbers."
          : "The matter has class numbers but no goods/services on file. Add the goods/services.",
    );
  }

  // ── government fees text ───────────────────────────────────────────────────
  const govText = govLines.length > 0 ? govFeesText(govLines, currency) : "[none on the signed quote — confirm before sending]";

  // ── general-LOE fields ─────────────────────────────────────────────────────
  // The amount due at filing is NOT all the firm's fee: on a trademark quote it is
  // mostly the USPTO's government fee (pricing.ts §0). Calling it part of a "flat
  // fee" would tell the client the firm charges it, so the two are named apart.
  const filingLegal = taken
    .filter((line) => line.kind !== "government_fee" && chargeBucket(line) === "filing")
    .reduce((sum, line) => sum + frozenAmountCents(line), 0);
  const filingGov = govLines.filter((line) => chargeBucket(line) === "filing").reduce((sum, line) => sum + frozenAmountCents(line), 0);
  if (filingLegal + filingGov !== dueAtFiling) {
    checks.push(
      `The signed copy's amount due at filing (${dollars(dueAtFiling, currency)}) does not equal its filing lines added up (${dollars(filingLegal + filingGov, currency)}). The fee structure names the lines; check the quote before sending.`,
    );
  }
  const feeParts = [`Flat fee: ${dollars(dueAtSigning, currency)} due at signing`];
  if (filingLegal !== 0) feeParts.push(`${dollars(filingLegal, currency)} more of the firm's fee due at filing`);
  if (filingGov !== 0) feeParts.push(`USPTO government filing fees of ${dollars(filingGov, currency)}, due at filing (not part of the firm's fee)`);
  const feeStructure = feeParts.join("; ");
  // What a deposit % applies to is the firm's quoted fee: what is due at signing
  // plus any of the firm's own fee due at filing. Never the government fees.
  const quotedLegalFee = dueAtSigning + filingLegal;

  return {
    quoteId: input.quoteId,
    reference: quoteReference(input.quoteId).toUpperCase(),
    acceptedOn: formatSignedOn(snapshot.accepted_at ?? input.acceptedAt ?? null, input.timeZone),
    signerName: snapshot.signature?.name?.trim() || null,
    packageName,
    markText,
    markFrom,
    classCount: classCount > 0 ? String(classCount) : "",
    classSelected,
    amountPaid: dollars(dueAtSigning, currency),
    amountPaidMath,
    benefitRowsText,
    govFeesText: govText,
    scopeDescription: rowLines.map((line) => (line.label ?? "").trim()).filter(Boolean).join("\n"),
    feeStructure,
    quotedAmount: quotedLegalFee > 0 ? centsToInput(quotedLegalFee) : "",
    totals: {
      dueAtSigning: dollars(dueAtSigning, currency),
      dueAtFiling: dollars(dueAtFiling, currency),
      fullProjectCost: dollars(fullProject, currency),
    },
    checks,
  };
}

/* ─────────────────────── which signed quote to use ─────────────────────── */

/** `?quote=` values with a meaning of their own. Anything else is a quote id. */
export const LOE_QUOTE_NONE = "none";
export const LOE_QUOTE_PICK = "pick";

export type LoeQuoteChoice = {
  /**
   * none       no signed quote on this matter: today's blank form
   * prefill    exactly one quote is in play: pre-fill from it
   * pick       several signed quotes and none chosen: staff choose, no guess
   * manual     staff chose to fill it in by hand
   * unreadable the chosen (or only) quote is signed but its signed copy cannot be read
   */
  mode: "none" | "prefill" | "pick" | "manual" | "unreadable";
  quoteId: string | null;
  /** The `?quote=` value named no signed quote on this matter. */
  invalidParam: boolean;
};

/**
 * Decides, from the matter's signed quotes and the `?quote=` parameter, what the
 * page shows. With several signed quotes it never picks one: which engagement a
 * letter is for is staff's call, and a wrong guess puts the wrong amount in a
 * letter.
 */
export function chooseLoeQuote(quotes: readonly { quoteId: string; readable: boolean }[], param: string | undefined): LoeQuoteChoice {
  if (quotes.length === 0) return { mode: "none", quoteId: null, invalidParam: false };
  const value = (param ?? "").trim();
  if (value === LOE_QUOTE_NONE) return { mode: "manual", quoteId: null, invalidParam: false };

  const named = value && value !== LOE_QUOTE_PICK ? quotes.find((q) => q.quoteId === value) : undefined;
  if (named) return { mode: named.readable ? "prefill" : "unreadable", quoteId: named.quoteId, invalidParam: false };

  const invalidParam = value !== "" && value !== LOE_QUOTE_PICK;
  if (quotes.length > 1) return { mode: "pick", quoteId: null, invalidParam };
  const only = quotes[0];
  return { mode: only.readable ? "prefill" : "unreadable", quoteId: only.quoteId, invalidParam };
}

/* ───────────────────── edits against the signed quote ──────────────────── */

/** What the staff member submitted, for the fields a signed quote answers. A
 * field left `undefined` is not compared. */
export type LoeSubmitted = {
  packageName?: string;
  markText?: string;
  classCount?: number | null;
  amountPaid?: string;
  govFeesText?: string;
  quotedAmount?: number | null;
  /** The chart rows, one per line. Each row carries a signed amount. */
  benefitRowsText?: string;
  amountPaidMath?: string;
  feeStructure?: string;
  scopeDescription?: string;
};

/** A multi-line field as its rows: trimmed, no bullets, no blanks. */
function rowsOf(text: string): string[] {
  return text
    .split("\n")
    .map((row) => norm(row.replace(/^\s*[-•*]\s+/, "")))
    .filter(Boolean);
}

/** Rows in `a` that `b` does not have (as a multiset, ignoring case). */
function rowsMissing(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const row of b) left.set(row.toLowerCase(), (left.get(row.toLowerCase()) ?? 0) + 1);
  const out: string[] = [];
  for (const row of a) {
    const n = left.get(row.toLowerCase()) ?? 0;
    if (n > 0) left.set(row.toLowerCase(), n - 1);
    else out.push(row);
  }
  return out;
}

function rowsDifference(label: string, ref: string, submitted: string, signed: string): string | null {
  const entered = rowsOf(submitted);
  const quoted = rowsOf(signed);
  const removed = rowsMissing(quoted, entered);
  const added = rowsMissing(entered, quoted);
  if (removed.length === 0 && added.length === 0) return null;
  const parts: string[] = [];
  if (removed.length > 0) parts.push(`not in the letter: ${removed.map((r) => `"${r}"`).join(", ")}`);
  if (added.length > 0) parts.push(`not on ${ref}: ${added.map((r) => `"${r}"`).join(", ")}`);
  return `${label} differ from ${ref} — ${parts.join("; ")}.`;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const sameText = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();

/**
 * Where the submitted letter differs from the signed quote, as sentences for
 * the approver. Fields stay editable — the quote may be wrong, or the letter
 * may legitimately differ — but a figure that departs from what the client
 * signed is never silent: it is printed in the draft Rebecca reviews.
 */
export function loeDifferences(prefill: LoePrefill, submitted: LoeSubmitted): string[] {
  const out: string[] = [];
  const ref = prefill.reference;

  if (submitted.packageName !== undefined && prefill.packageName && !sameText(submitted.packageName, prefill.packageName)) {
    out.push(`Package is entered as "${norm(submitted.packageName)}"; ${ref} says "${prefill.packageName}".`);
  }
  if (submitted.markText !== undefined && prefill.markText && !sameText(submitted.markText, prefill.markText)) {
    out.push(`Mark is entered as "${norm(submitted.markText)}"; ${ref} says "${prefill.markText}".`);
  }
  if (submitted.classCount !== undefined && prefill.classCount && Number(prefill.classCount) !== submitted.classCount) {
    out.push(`Class count is entered as ${submitted.classCount ?? "none"}; ${ref} says ${prefill.classCount}.`);
  }
  if (submitted.amountPaid !== undefined && prefill.amountPaid) {
    const entered = parseDollarsToCents(submitted.amountPaid);
    const signed = parseDollarsToCents(prefill.amountPaid);
    const same = entered !== null && signed !== null ? entered === signed : sameText(submitted.amountPaid, prefill.amountPaid);
    if (!same) out.push(`Amount paid is entered as ${norm(submitted.amountPaid)}; ${ref} says ${prefill.amountPaid}.`);
  }
  if (submitted.govFeesText !== undefined && prefill.govFeesText && norm(submitted.govFeesText) !== norm(prefill.govFeesText)) {
    out.push(
      submitted.govFeesText.trim()
        ? `Government fees are entered as ${norm(submitted.govFeesText)}; ${ref} says ${prefill.govFeesText}.`
        : `Government fees were left blank, so the letter computes them from the class count; ${ref} says ${prefill.govFeesText}.`,
    );
  }
  if (submitted.quotedAmount !== undefined && prefill.quotedAmount) {
    const signed = parseDollarsToCents(prefill.quotedAmount);
    const entered = submitted.quotedAmount === null ? null : Math.round(submitted.quotedAmount * 100);
    if (entered !== signed) {
      out.push(
        `Quoted amount is entered as ${entered === null ? "nothing" : `$${centsToInput(entered)}`}; ${ref} says $${prefill.quotedAmount}.`,
      );
    }
  }
  if (submitted.amountPaidMath !== undefined && prefill.amountPaidMath && !sameText(submitted.amountPaidMath, prefill.amountPaidMath)) {
    out.push(
      submitted.amountPaidMath.trim()
        ? `Discount math is entered as "${norm(submitted.amountPaidMath)}"; ${ref} says "${prefill.amountPaidMath}".`
        : `Discount math was removed; ${ref} says "${prefill.amountPaidMath}".`,
    );
  } else if (submitted.amountPaidMath !== undefined && !prefill.amountPaidMath && submitted.amountPaidMath.trim()) {
    out.push(`Discount math "${norm(submitted.amountPaidMath)}" was added; ${ref} has none.`);
  }
  if (submitted.benefitRowsText !== undefined) {
    const diff = rowsDifference("Chart rows", ref, submitted.benefitRowsText, prefill.benefitRowsText);
    if (diff) out.push(diff);
  }
  if (submitted.feeStructure !== undefined && prefill.feeStructure && !sameText(submitted.feeStructure, prefill.feeStructure)) {
    out.push(`Fee structure is entered as "${norm(submitted.feeStructure)}"; ${ref} says "${prefill.feeStructure}".`);
  }
  if (submitted.scopeDescription !== undefined) {
    const diff = rowsDifference("Scope lines", ref, submitted.scopeDescription, prefill.scopeDescription);
    if (diff) out.push(diff);
  }
  return out;
}
