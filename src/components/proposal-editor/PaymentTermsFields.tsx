import { PAYMENT_TERMS_LIMITS } from "@/lib/proposals/due-today";
import { PAYMENT_TERMS_MARKER } from "@/lib/proposal-editor/payment-terms-form";
import { PAYMENT_TERMS_WORDS } from "@/lib/proposal-editor/vocabulary";
import { fieldId } from "@/lib/proposal-editor/checklist";

/**
 * "Due today (%)" and "Balance due": a deposit on the fee, saved with the editor's one Save (`applyPaymentTermsForm`). The
 * marker tells the save these fields were on the page, so clearing them removes the terms. No amount is worked out here.
 */
export function PaymentTermsFields({ values }: { values: { dueNowPct: string; balanceNote: string } }) {
  return (
    <div className="lx-form-grid" role="group" aria-label={PAYMENT_TERMS_WORDS.dueNowLabel}>
      <input type="hidden" name={PAYMENT_TERMS_MARKER} value="1" />
      <label className="lx-field">
        <span className="lx-label">{PAYMENT_TERMS_WORDS.dueNowLabel}</span>
        <input className="lx-input" id={fieldId.dueNowPct} name="dueNowPct" inputMode="numeric" defaultValue={values.dueNowPct} placeholder="100" />
        <span className="lx-note">{PAYMENT_TERMS_WORDS.dueNowHint}</span>
      </label>
      <label className="lx-field">
        <span className="lx-label">{PAYMENT_TERMS_WORDS.balanceLabel}</span>
        <input
          className="lx-input"
          id={fieldId.balanceNote}
          name="balanceNote"
          maxLength={PAYMENT_TERMS_LIMITS.balanceNote}
          defaultValue={values.balanceNote}
          placeholder={PAYMENT_TERMS_WORDS.balancePlaceholder}
        />
        <span className="lx-note">{PAYMENT_TERMS_WORDS.balanceHint}</span>
      </label>
    </div>
  );
}
