// Ported from lectual (Document Center form); restyled onto lx tokens. lectual.app adds the
// signed-quote pre-fill: every pre-filled field is an ordinary editable input, the template
// choice is never pre-selected, and the submit does not clear what was typed on an error.
"use client";

import { startTransition, useActionState, useState } from "react";
import type { LoePrefill } from "@/lib/documents/loe-prefill";
import { generateLoeAction, type LoeState } from "../actions";

const buttonBase: React.CSSProperties = {
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "var(--font-geist), sans-serif",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  width: "100%",
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "9px 16px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  border: "var(--line-2) solid var(--line)",
  background: active ? "var(--ox)" : "transparent",
  color: active ? "var(--cream)" : "var(--muted)",
  cursor: "pointer",
});

/** A small "where this came from" tag on a label, shown only when a field is pre-filled. */
function From({ what }: { what: string | null }) {
  if (!what) return null;
  return <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · from {what}</span>;
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
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="kind" value={kind} />
      {prefill && <input type="hidden" name="quoteId" value={prefill.quoteId} />}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={tabStyle(kind === "trademark")} onClick={() => setKind("trademark")}>
          Trademark
        </button>
        <button type="button" style={tabStyle(kind === "general")} onClick={() => setKind("general")}>
          General (non-trademark)
        </button>
      </div>

      <article className="lx-card" style={{ display: "grid", gap: 12, padding: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Client name{defaultClientName ? <From what="the matter's client record" /> : null}
            </span>
            <input type="text" name="clientName" required defaultValue={defaultClientName ?? ""} className="lx-input" />
          </label>
          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Entity name (optional)
            </span>
            <input type="text" name="entityName" className="lx-input" />
          </label>
        </div>

        {kind === "trademark" ? (
          <>
            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend className="lx-label" style={{ fontSize: 10, marginBottom: 4 }}>
                Template — required, never guessed
              </legend>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                <input type="radio" name="variant" value="current" required />
                Current
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                <input type="radio" name="variant" value="legacy" required />
                Legacy — only for existing clients still on old package pricing
              </label>
            </fieldset>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Mark{prefill?.markFrom ? <From what={prefill.markFrom === "signed terms" ? "the signed terms" : "the matter's file"} /> : null}
                </span>
                <input type="text" name="markText" required defaultValue={prefill ? prefill.markText : (defaultMarkText ?? "")} className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
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
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Class(es) purchased (count)<From what={prefill?.classCount ? quote : null} />
                </span>
                <input type="number" name="classCount" min={1} required defaultValue={prefill?.classCount ?? ""} className="lx-input" />
              </label>
            </div>

            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Class selected — description(s), verbatim from the pricing email<From what={prefill?.classSelected ? "the matter's file" : null} />
              </span>
              <input type="text" name="classSelected" required defaultValue={prefill?.classSelected ?? ""} className="lx-input" />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Amount paid — verbatim from the pricing email<From what={quote} />
                </span>
                <input type="text" name="amountPaid" required defaultValue={prefill?.amountPaid ?? ""} placeholder="$2,525" className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Discount math shown (optional)<From what={prefill?.amountPaidMath ? quote : null} />
                </span>
                <input type="text" name="amountPaidMath" defaultValue={prefill?.amountPaidMath ?? ""} placeholder="$2,775 − $250 = $2,525" className="lx-input" />
              </label>
            </div>

            {prefill && (
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Government filing fees<From what={quote} />
                </span>
                <input type="text" name="govFeesText" defaultValue={prefill.govFeesText} className="lx-input" />
              </label>
            )}

            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                {prefill
                  ? "Chart rows — the lines the client signed for (one per line)"
                  : "Package benefit rows kept for this chosen package (one per line)"}
                <From what={prefill?.benefitRowsText ? quote : null} />
              </span>
              <textarea
                name="benefitRowsText"
                rows={6}
                className="lx-input"
                style={{ resize: "vertical", fontFamily: "inherit" }}
                defaultValue={prefill?.benefitRowsText ?? ""}
                placeholder={"Preliminary Consultation Strategy Call ($450) — ✓\nComprehensive Trademark Search Report ($675 each) — 1 included"}
              />
            </label>
          </>
        ) : (
          <>
            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Scope — from the proposal email / consult notes (Claude turns this into bullet
                points)<From what={prefill?.scopeDescription ? `${quote}'s lines` : null} />
              </span>
              <textarea
                name="scopeDescription"
                rows={5}
                required
                defaultValue={prefill?.scopeDescription ?? ""}
                className="lx-input"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>
            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Fee structure — exactly as stated in the proposal<From what={quote} />
              </span>
              <input type="text" name="feeStructure" required defaultValue={prefill?.feeStructure ?? ""} placeholder="hourly at $450/hr" className="lx-input" />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Deposit % (optional)
                </span>
                <input type="number" name="depositPercent" min={0} max={100} className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Quoted amount the % applies to (optional)<From what={prefill?.quotedAmount ? quote : null} />
                </span>
                <input type="number" name="quotedAmount" min={0} step="0.01" defaultValue={prefill?.quotedAmount ?? ""} className="lx-input" />
              </label>
            </div>
            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
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
          <p role="alert" style={{ color: "var(--wine)", fontSize: 13 }}>
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{ ...buttonBase, background: "var(--ox)", color: "var(--cream)" }}
        >
          {pending ? "Preparing the LOE…" : "Generate LOE"}
        </button>
      </article>
    </form>
  );
}
