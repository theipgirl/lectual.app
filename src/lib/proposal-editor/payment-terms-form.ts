/**
 * The editor's "Due today (%)" and "Balance due" fields, read into `content.payment_terms`. Pure (FormData in, content or one
 * fixed sentence out). The fields are only read when the form carries the `payTermsFields` marker, so a form without them
 * (another section's post, New proposal) leaves the stored terms exactly as they were.
 *
 *   dueNowPct    blank or 100 = the whole fee is due today (the terms are removed); else a whole percent 1..99.
 *   balanceNote  when the balance is due ("upon delivery of the agreements"), 1..120 characters of plain text; blank = none.
 *
 * No amount is worked out here: the split is `due-today.ts#dueToday`, from the quote.
 */

import type { PaymentTerms, ProposalContent } from "@/lib/proposals/types";
import { PAYMENT_TERMS_LIMITS, paymentTermsIssues } from "@/lib/proposals/due-today";
import { PAYMENT_TERMS_WORDS } from "./vocabulary";
import type { Parsed } from "./form";

export const PAYMENT_TERMS_MARKER = "payTermsFields";

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** The terms the fields describe: null = the whole fee due today. */
export function parsePaymentTermsFields(form: FormData): Parsed<PaymentTerms | null> {
  const rawPct = text(form, "dueNowPct").replace(/%$/, "").trim();
  const note = text(form, "balanceNote");
  if (!rawPct) {
    if (note) return { ok: false, error: PAYMENT_TERMS_WORDS.noteWithoutPct };
    return { ok: true, value: null };
  }
  if (!/^\d{1,3}$/.test(rawPct)) return { ok: false, error: PAYMENT_TERMS_WORDS.badPct };
  const pct = Number(rawPct);
  if (pct < PAYMENT_TERMS_LIMITS.minPct || pct > PAYMENT_TERMS_LIMITS.maxPct) return { ok: false, error: PAYMENT_TERMS_WORDS.badPct };
  if (pct === 100) return { ok: true, value: null };
  const terms: PaymentTerms = note ? { due_now_pct: pct, balance_note: note } : { due_now_pct: pct };
  if (paymentTermsIssues(terms).length > 0) {
    return { ok: false, error: note.length > PAYMENT_TERMS_LIMITS.balanceNote ? PAYMENT_TERMS_WORDS.noteTooLong : PAYMENT_TERMS_WORDS.notePlain };
  }
  return { ok: true, value: terms };
}

/** The content with the posted terms applied; untouched when the form doesn't carry the fields. */
export function applyPaymentTermsForm(form: FormData, content: ProposalContent): Parsed<ProposalContent> {
  if (!form.has(PAYMENT_TERMS_MARKER)) return { ok: true, value: content };
  const parsed = parsePaymentTermsFields(form);
  if (!parsed.ok) return parsed;
  const next: ProposalContent = { ...content };
  if (parsed.value) next.payment_terms = parsed.value;
  else delete next.payment_terms;
  return { ok: true, value: next };
}

/** The fields' starting values. */
export function paymentTermsValues(content: Pick<ProposalContent, "payment_terms">): { dueNowPct: string; balanceNote: string } {
  const t = content.payment_terms;
  return {
    dueNowPct: t && typeof t.due_now_pct === "number" ? String(t.due_now_pct) : "",
    balanceNote: t && typeof t.balance_note === "string" ? t.balance_note : "",
  };
}
