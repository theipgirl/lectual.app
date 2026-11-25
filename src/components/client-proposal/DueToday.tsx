import { balanceLabel, DUE_TODAY_NOTE, dueTodayLabel, PAID_IN_TWO_PARTS, payTodayLine } from "@/lib/loe/client-words";
import { activePaymentTerms, balancePct, dueToday, type DueToday } from "@/lib/proposals/due-today";
import type { PaymentTerms, ProposalContent, ProposalQuote } from "@/lib/proposals/types";
import { money } from "./format";

/**
 * A deposit on the fee ("Due today"), for both kinds of proposal. `depositOf` answers null when the content has no terms or
 * 100% is due now, and every caller then draws exactly what it drew before. The figures are `dueToday`'s, from the quote the
 * page already priced; USPTO fees are never part of it.
 */
export type Deposit = { terms: PaymentTerms; split: DueToday };

export function depositOf(content: Pick<ProposalContent, "payment_terms">, quote: Pick<ProposalQuote, "legal_total_cents">): Deposit | null {
  const terms = activePaymentTerms(content);
  return terms ? { terms, split: dueToday(quote, terms) } : null;
}

/** The totals panel's rows when the fee is paid in two parts: the total, then "Due today (50%)" (the amount to pay now), then the balance. */
export function DueTodayRows({ deposit, totalLabel }: { deposit: Deposit; totalLabel: string }) {
  const { terms, split } = deposit;
  return (
    <>
      <div className="cp-row">
        <div className="cp-l">
          <b>{totalLabel}</b>
          <span>{PAID_IN_TWO_PARTS}</span>
        </div>
        <div className="cp-mid cp-num">{money(split.total_cents)}</div>
      </div>
      <div className="cp-row cp-due-today">
        <div className="cp-l">
          <b>{dueTodayLabel(terms.due_now_pct)}</b>
          <span>{DUE_TODAY_NOTE}</span>
        </div>
        <div className="cp-big cp-num">{money(split.due_now_cents)}</div>
      </div>
      <div className="cp-row cp-balance">
        <div className="cp-l">
          <b>{balanceLabel(balancePct(terms), terms.balance_note)}</b>
        </div>
        <div className="cp-mid cp-num">{money(split.balance_cents)}</div>
      </div>
    </>
  );
}

/** Next to the pay button after acceptance: "Pay $1,732.50 today", so the client knows what to enter in the payment form. */
export function PayToday({ deposit }: { deposit: Deposit | null }) {
  if (!deposit) return null;
  return (
    <p className="cp-paytoday" role="note">
      <b className="cp-num">{payTodayLine(money(deposit.split.due_now_cents))}</b>
    </p>
  );
}
