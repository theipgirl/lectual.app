// Ported from lectual (Document Center form); restyled onto lx tokens. lectual.app adds the
// signed-quote pre-fill: every pre-filled field is an ordinary editable input, the template
// choice is never pre-selected, and the submit does not clear what was typed on an error.
"use client";

import { startTransition, useActionState, useState } from "react";
import { Notice } from "@/components/ui";
import { SAVING } from "@/lib/ui/words";
import "@/components/documents/documents.css";
import type { LoePrefill } from "@/lib/documents/loe-prefill";
import { generateLoeAction, type LoeState } from "../actions";

/** A small "where this came from" tag on a label, shown only when a field is pre-filled. */
function From({ what }: { what: string | null }) {
  if (!what) return null;
  return <span className="dl-from"> · from {what}</span>;
}

export default function LoeForm({
  matterId,
  defaultMarkText,
  defaultPackage,
  prefill,
  defaultClientName,
  initialKind,
}: {
  matterId: string;
  defaultMarkText?: string | null;
  defaultPackage?: string | null;
  /** The signed quote's figures. Absent: the blank form this has always been. */
  prefill?: LoePrefill | null;
  defaultClientName?: string;
  initialKind?: "trademark" | "general";
}) {
  const [state, formAction, pending] = useActionState<LoeState, FormData>(generateLoeAction, {});
  const [kind, setKind] = useState<"trademark" | "general">(initialKind ?? "trademark");
  const quote = prefill ? "the signed quote" : null;

  // Submitted through a transition rather than the form's `action`, so React does
  // not reset the fields when the action returns: an error ("Select a template")
  // must not throw away a dozen pre-filled and hand-edited values.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="dl-form">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="kind" value={kind} />
      {prefill && <input type="hidden" name="quoteId" value={prefill.quoteId} />}

      <div className="vs-switch" role="group" aria-label="Letter type">
        <button type="button" aria-pressed={kind === "trademark"} onClick={() => setKind("trademark")}>
          Trademark
        </button>
        <button type="button" aria-pressed={kind === "general"} onClick={() => setKind("general")}>
          General (non-trademark)
        </button>
      </div>

      <article className="lx-card lx-pad dl-form-card">
        <div className="dl-grid dl-grid-200">
          <label className="lx-field">
            <span className="lx-label">
              Client name{defaultClientName ? <From what="the matter's client record" /> : null}
            </span>
            <input type="text" name="clientName" required defaultValue={defaultClientName ?? ""} className="lx-input" />
          </label>
          <label className="lx-field">
            <span className="lx-label">
              Entity name (optional)
            </span>
            <input type="text" name="entityName" className="lx-input" />
          </label>
        </div>

        {kind === "trademark" ? (
          <>
            <fieldset className="dl-fieldset">
              <legend className="lx-label">
                Template — required, never guessed
              </legend>
              <label className="dl-radio">
                <input type="radio" name="variant" value="current" required />
                Current
              </label>
              <label className="dl-radio">
                <input type="radio" name="variant" value="legacy" required />
                Legacy — only for existing clients still on old package pricing
              </label>
            </fieldset>

            <div className="dl-grid dl-grid-160">
              <label className="lx-field">
                <span className="lx-label">
                  Mark{prefill?.markFrom ? <From what={prefill.markFrom === "signed terms" ? "the signed terms" : "the matter's file"} /> : null}
                </span>
                <input type="text" name="markText" required defaultValue={prefill ? prefill.markText : (defaultMarkText ?? "")} className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label">
                  Package<From what={prefill?.packageName ? quote : null} />
                </span>
                <input
                  type="text"
                  name="packageName"
                  required
                  defaultValue={prefill ? prefill.packageName : (defaultPackage ?? "")}
                  placeholder="ESSENTIAL / ENHANCED / CONCIERGE"
                  className="lx-input"
                />
              </label>
              <label className="lx-field">
                <span className="lx-label">
                  Class(es) purchased (count)<From what={prefill?.classCount ? quote : null} />
                </span>
                <input type="number" name="classCount" min={1} required defaultValue={prefill?.classCount ?? ""} className="lx-input" />
              </label>
            </div>

            <label className="lx-field">
              <span className="lx-label">
                Class selected — description(s), verbatim from the pricing email<From what={prefill?.classSelected ? "the matter's file" : null} />
              </span>
              <input type="text" name="classSelected" required defaultValue={prefill?.classSelected ?? ""} className="lx-input" />
            </label>

            <div className="dl-grid dl-grid-200">
              <label className="lx-field">
                <span className="lx-label">
                  Amount paid — verbatim from the pricing email<From what={quote} />
                </span>
                <input type="text" name="amountPaid" required defaultValue={prefill?.amountPaid ?? ""} placeholder="$2,525" className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label">
                  Discount math shown (optional)<From what={prefill?.amountPaidMath ? quote : null} />
                </span>
                <input type="text" name="amountPaidMath" defaultValue={prefill?.amountPaidMath ?? ""} placeholder="$2,775 − $250 = $2,525" className="lx-input" />
              </label>
            </div>

            {prefill && (
              <label className="lx-field">
                <span className="lx-label">
                  Government filing fees<From what={quote} />
                </span>
                <input type="text" name="govFeesText" defaultValue={prefill.govFeesText} className="lx-input" />
              </label>
            )}

            <label className="lx-field">
              <span className="lx-label">
                {prefill
                  ? "Chart rows — the lines the client signed for (one per line)"
                  : "Package benefit rows kept for this chosen package (one per line)"}
                <From what={prefill?.benefitRowsText ? quote : null} />
              </span>
              <textarea
                name="benefitRowsText"
                rows={6}
                className="lx-input"
                defaultValue={prefill?.benefitRowsText ?? ""}
                placeholder={"Preliminary Consultation Strategy Call ($450) — ✓\nComprehensive Trademark Search Report ($675 each) — 1 included"}
              />
            </label>
          </>
        ) : (
          <>
            <label className="lx-field">
              <span className="lx-label">
                Scope — from the proposal email / consult notes (Claude turns this into bullet
                points)<From what={prefill?.scopeDescription ? `${quote}'s lines` : null} />
              </span>
              <textarea
                name="scopeDescription"
                rows={5}
                required
                defaultValue={prefill?.scopeDescription ?? ""}
                className="lx-input"
              />
            </label>
            <label className="lx-field">
              <span className="lx-label">
                Fee structure — exactly as stated in the proposal<From what={quote} />
              </span>
              <input type="text" name="feeStructure" required defaultValue={prefill?.feeStructure ?? ""} placeholder="hourly at $450/hr" className="lx-input" />
            </label>
            <div className="dl-grid dl-grid-160">
              <label className="lx-field">
                <span className="lx-label">
                  Deposit % (optional)
                </span>
                <input type="number" name="depositPercent" min={0} max={100} className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label">
                  Quoted amount the % applies to (optional)<From what={prefill?.quotedAmount ? quote : null} />
                </span>
                <input type="number" name="quotedAmount" min={0} step="0.01" defaultValue={prefill?.quotedAmount ?? ""} className="lx-input" />
              </label>
            </div>
            <label className="lx-field">
              <span className="lx-label">
                Deposit terms as stated (if no % given)
              </span>
              <input
                type="text"
                name="depositStatedTerms"
                placeholder="we require a 50% deposit to commence work"
                className="lx-input"
              />
            </label>
          </>
        )}

        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}

        <button
          type="submit"
          className="lx-btn lx-btn-pri dl-submit"
          disabled={pending}
        >
          {pending ? SAVING : "Generate LOE"}
        </button>
      </article>
    </form>
  );
}
