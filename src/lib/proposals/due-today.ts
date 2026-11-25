/**
 * "Due today": a deposit on the legal fee (both kinds of proposal). PURE, no database, no Node-only import: the client page,
 * the staff page, the editor and the accept path all read it.
 *
 * `content.payment_terms = { due_now_pct, balance_note? }` says how much of the LEGAL fee is paid now. The figures come from
 * the quote `quoteProposal` made (this file does no pricing and `pricing.ts` is not touched): the total is the quote's
 * `legal_total_cents`, the part due now is `round(total x pct / 100)` in whole cents, and the balance is the rest, so the two
 * always add up to the total. USPTO / government fees are never part of the deposit: they stay "due at filing" as before.
 *
 * With no terms, or `due_now_pct` 100, nothing changes anywhere (`activePaymentTerms` answers null and every caller draws
 * exactly what it drew before).
 */

import type { PaymentTerms, ProposalContent, ProposalQuote } from "./types";

export const PAYMENT_TERMS_LIMITS = { minPct: 1, maxPct: 100, balanceNote: 120 } as const;

export type DueToday = { total_cents: number; due_now_cents: number; balance_cents: number };

/** The split of the quote's legal total. Terms absent or not usable = the whole total is due now. */
export function dueToday(quote: Pick<ProposalQuote, "legal_total_cents">, terms: PaymentTerms | null | undefined): DueToday {
  const total = Number.isFinite(quote?.legal_total_cents) ? Math.max(0, Math.round(quote.legal_total_cents)) : 0;
  const pct = isValidPct(terms?.due_now_pct) ? terms!.due_now_pct : 100;
  const dueNow = Math.round((total * pct) / 100);
  return { total_cents: total, due_now_cents: dueNow, balance_cents: total - dueNow };
}

function isValidPct(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= PAYMENT_TERMS_LIMITS.minPct && v <= PAYMENT_TERMS_LIMITS.maxPct;
}

/** Plain text: no angle brackets and no control characters. */
function isPlainText(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "<" || ch === ">" || code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/**
 * The terms that change what the page shows: a valid percent BELOW 100 (and a usable note, else none). Anything else,
 * absent terms and 100% included, is null, and the page is drawn exactly as before.
 */
export function activePaymentTerms(content: Pick<ProposalContent, "payment_terms"> | null | undefined): PaymentTerms | null {
  const t = content?.payment_terms;
  if (!t || typeof t !== "object" || !isValidPct(t.due_now_pct) || t.due_now_pct >= 100) return null;
  const note = typeof t.balance_note === "string" ? t.balance_note.trim() : "";
  return note && note.length <= PAYMENT_TERMS_LIMITS.balanceNote && isPlainText(note)
    ? { due_now_pct: t.due_now_pct, balance_note: note }
    : { due_now_pct: t.due_now_pct };
}

/** `validateContent`'s rules for `payment_terms` (both kinds). Returns [path, message] pairs. */
export function paymentTermsIssues(raw: unknown): Array<{ path: string; message: string }> {
  if (raw === undefined) return [];
  const out: Array<{ path: string; message: string }> = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{ path: "payment_terms", message: "The payment terms are not readable." }];
  const t = raw as Record<string, unknown>;
  if (!isValidPct(t.due_now_pct)) {
    out.push({ path: "payment_terms.due_now_pct", message: "The part due today must be a whole percent from 1 to 100." });
  }
  if (t.balance_note !== undefined) {
    const note = typeof t.balance_note === "string" ? t.balance_note.trim() : null;
    if (note === null || !note) out.push({ path: "payment_terms.balance_note", message: "Say when the balance is due, or leave it out." });
    else if (note.length > PAYMENT_TERMS_LIMITS.balanceNote) {
      out.push({ path: "payment_terms.balance_note", message: `Keep when the balance is due to ${PAYMENT_TERMS_LIMITS.balanceNote} characters.` });
    } else if (!isPlainText(note)) out.push({ path: "payment_terms.balance_note", message: "When the balance is due must be plain text." });
  }
  return out;
}

/** The balance's percent, for its label ("Balance (50%)"). */
export function balancePct(terms: PaymentTerms): number {
  return 100 - terms.due_now_pct;
}
