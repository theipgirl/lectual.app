// Ported from lectual (Document Center form); logic unchanged, restyled onto lx tokens.
"use client";

import { useActionState, useState } from "react";
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

export default function LoeForm({
  matterId,
  defaultMarkText,
  defaultPackage,
}: {
  matterId: string;
  defaultMarkText?: string | null;
  defaultPackage?: string | null;
}) {
  const [state, formAction, pending] = useActionState<LoeState, FormData>(generateLoeAction, {});
  const [kind, setKind] = useState<"trademark" | "general">("trademark");

  return (
    <form action={formAction} style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="kind" value={kind} />

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
              Client name
            </span>
            <input type="text" name="clientName" required className="lx-input" />
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
                Current (default for new clients)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                <input type="radio" name="variant" value="legacy" required />
                Legacy — only for existing clients still on old package pricing
              </label>
            </fieldset>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Mark
                </span>
                <input type="text" name="markText" required defaultValue={defaultMarkText ?? ""} className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Package
                </span>
                <input
                  type="text"
                  name="packageName"
                  required
                  defaultValue={defaultPackage ?? ""}
                  placeholder="ESSENTIAL / ENHANCED / CONCIERGE"
                  className="lx-input"
                />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Class(es) purchased (count)
                </span>
                <input type="number" name="classCount" min={1} required className="lx-input" />
              </label>
            </div>

            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Class selected — description(s), verbatim from the pricing email
              </span>
              <input type="text" name="classSelected" required className="lx-input" />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Amount paid — verbatim from the pricing email
                </span>
                <input type="text" name="amountPaid" required placeholder="$2,525" className="lx-input" />
              </label>
              <label className="lx-field">
                <span className="lx-label" style={{ fontSize: 10 }}>
                  Discount math shown (optional)
                </span>
                <input type="text" name="amountPaidMath" placeholder="$2,775 − $250 = $2,525" className="lx-input" />
              </label>
            </div>

            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Package benefit rows kept for this chosen package (one per line)
              </span>
              <textarea
                name="benefitRowsText"
                rows={6}
                className="lx-input"
                style={{ resize: "vertical", fontFamily: "inherit" }}
                placeholder={"Preliminary Consultation Strategy Call ($450) — ✓\nComprehensive Trademark Search Report ($675 each) — 1 included"}
              />
            </label>
          </>
        ) : (
          <>
            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Scope — from the proposal email / consult notes (Claude turns this into bullet
                points)
              </span>
              <textarea name="scopeDescription" rows={5} required className="lx-input" style={{ resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <label className="lx-field">
              <span className="lx-label" style={{ fontSize: 10 }}>
                Fee structure — exactly as stated in the proposal
              </span>
              <input type="text" name="feeStructure" required placeholder="hourly at $450/hr" className="lx-input" />
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
                  Quoted amount the % applies to (optional)
                </span>
                <input type="number" name="quotedAmount" min={0} step="0.01" className="lx-input" />
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
