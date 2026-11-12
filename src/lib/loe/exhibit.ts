import { generalValueOverFee } from "@/lib/proposals/pricing";
import { MARK_KIND_LABEL, isGeneralContent, type ProposalContent, type ProposalQuote } from "@/lib/proposals/types";

/**
 * Exhibit A: Fee Structure and Estimated Costs, as plain data (strings only) built from the ONE price engine's quote.
 *
 * PURE FORMATTER. It does no money arithmetic: every figure is an amount the quote already holds, run through `money`
 * (a formatter) and nothing else. It never adds, subtracts or multiplies cents, so it cannot disagree with the page's
 * totals, the accepted snapshot or the signed PDF. A grep test holds that (`tests/loe/exhibit.test.ts`).
 *
 * The same `Exhibit` is drawn on the page (React text), written into the PDF, hashed into the fingerprint and put in
 * the agreement text the database stores, so what the client reads is what is signed.
 *
 * `content` is the EFFECTIVE content (the client's own class words and added classes already in it, see
 * `client-classes.ts`); `quote` is `quoteWithClientClasses`' quote over it. Only what was selected appears: the quote's
 * names, marks and classes are the picked ones.
 */

export const EXHIBIT_TITLE = "Exhibit A: Fee Structure and Estimated Costs";

export type ExhibitRow = {
  label: string;
  /** A short second line ("Enhanced", "second mark, 20% off"), or "". */
  detail: string;
  /** A formatted amount ("$3,250", "−$325"), or "" for a row that only names something. */
  amount: string;
};

export type ExhibitGroup = { title: string; rows: ExhibitRow[] };

export type ExhibitTotal = { label: string; note: string; amount: string };

export type Exhibit = {
  title: string;
  groups: ExhibitGroup[];
  /** The legal fee, due when the client pays. */
  legalDue: ExhibitTotal;
  /** USPTO fees, due at filing. Null on a flat-fee (general) proposal: it has none. */
  usptoDue: ExhibitTotal | null;
};

type Money = (cents: number) => string;

function row(label: string, detail: string, amount: string): ExhibitRow {
  return { label, detail, amount };
}

/** "−$325": the amount is the quote's own (positive) discount figure, shown as a reduction. */
function reduction(cents: number, money: Money): string {
  return `−${money(cents)}`;
}

function trademarkGroups(content: ProposalContent, quote: ProposalQuote, money: Money): ExhibitGroup[] {
  const groups: ExhibitGroup[] = [];
  for (const qn of quote.names) {
    if (!qn.included) continue;
    const rows: ExhibitRow[] = [];
    const nameDiscountPct = content.names.find((n) => n.id === qn.id)?.discount_pct;
    for (const m of qn.marks) {
      const kind = MARK_KIND_LABEL[m.kind] ?? m.kind;
      const bits: string[] = [];
      if (m.package) bits.push(m.package);
      else if (qn.package) bits.push(qn.package);
      if (m.second) bits.push("second mark");
      rows.push(row(kind, bits.join(", "), money(m.price_before_custom_discount_cents ?? m.price_cents)));
    }
    for (const c of qn.classes) rows.push(row(`Class: ${c.label}`, "", ""));
    if (qn.custom_discount_cents) {
      rows.push(row(qn.custom_discount_label || "Discount", "", reduction(qn.custom_discount_cents, money)));
    }
    if (qn.discount_cents) {
      rows.push(row("Discount", typeof nameDiscountPct === "number" ? `${Math.round(nameDiscountPct)}% off` : "", reduction(qn.discount_cents, money)));
    }
    rows.push(row(`Legal fee for ${qn.name}`, "", money(qn.legal_cents)));
    rows.push(row("USPTO filing fee, due at filing", `${qn.class_count} filing ${qn.class_count === 1 ? "class" : "classes"}`, money(qn.gov_cents)));
    groups.push({ title: qn.name, rows });
  }
  return groups;
}

function generalGroups(content: ProposalContent, quote: ProposalQuote, money: Money): ExhibitGroup[] {
  const rows: ExhibitRow[] = [];
  const g = quote.general;
  for (const it of g?.items ?? []) {
    const hours = typeof it.hours === "number" ? `${it.hours} ${it.hours === 1 ? "hour" : "hours"}` : "";
    rows.push(row(it.label, hours, ""));
  }
  const over = generalValueOverFee(quote);
  if (over) rows.push(row("Value of the work", "", money(over.value_cents)));
  rows.push(row("Flat fee", "", money(quote.legal_subtotal_cents)));
  return [{ title: content.general?.matter_title || "Matter", rows }];
}

export function buildExhibit(content: ProposalContent, quote: ProposalQuote, money: Money): Exhibit {
  const general = isGeneralContent(content);
  const groups = general ? generalGroups(content, quote, money) : trademarkGroups(content, quote, money);
  const credits = quote.adjustments.filter((a) => a.discount_cents > 0);
  if (credits.length > 0) {
    groups.push({
      title: "Credits",
      rows: credits.map((a) => row(a.label, a.kind === "percent" ? `${a.value}% off` : "", reduction(a.discount_cents, money))),
    });
  }
  return {
    title: EXHIBIT_TITLE,
    groups,
    legalDue: { label: "Legal fee due now", note: "Due now to begin", amount: money(quote.legal_total_cents) },
    usptoDue: general
      ? null
      : { label: "USPTO filing fees, due at filing", note: "Paid before filing, not today", amount: money(quote.gov_total_cents) },
  };
}

/** Plain-text lines of the exhibit, for the agreement text the database stores and the PDF's text layer. */
export function exhibitLines(exhibit: Exhibit): string[] {
  const out: string[] = [exhibit.title, ""];
  for (const g of exhibit.groups) {
    out.push(g.title);
    for (const r of g.rows) {
      const parts = [r.label, r.detail ? `(${r.detail})` : "", r.amount].filter(Boolean);
      out.push(`  ${parts.join(" ")}`);
    }
    out.push("");
  }
  out.push(`${exhibit.legalDue.label}: ${exhibit.legalDue.amount}`);
  if (exhibit.usptoDue) out.push(`${exhibit.usptoDue.label}: ${exhibit.usptoDue.amount}`);
  return out;
}

