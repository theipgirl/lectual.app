// Ported from lectual (Document Center form); logic unchanged, restyled onto lx tokens.
"use client";

import { useActionState } from "react";
import type { Matter } from "@/lib/matters";
import { generateTrademarkClearanceAction, type TrademarkClearanceState } from "../actions";

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

/** Matter's on-file filing_basis (1a/1b/44d/44e/66a) mapped to this flow's
 * two domestic options — a starting point only, never assumed correct: staff
 * still confirms it (same "always confirm, never invent" pattern as
 * OpinionLetterForm's honorific field). */
function defaultFilingBasis(matterFilingBasis: string | null): "1(a) Use in Commerce" | "1(b) Intent-to-Use" {
  return matterFilingBasis === "1b" ? "1(b) Intent-to-Use" : "1(a) Use in Commerce";
}

/**
 * Two-pane form: LEFT = the preliminary search findings the staff typed up
 * after running TESS/web searches themselves (no upload — there is no TMTKO
 * report at this pre-engagement stage), plus filing basis and entity name;
 * RIGHT = the matter facts the opinion will cite verbatim, same pattern as
 * OpinionLetterForm.
 */
export default function TrademarkClearanceForm({
  matterId,
  matter,
}: {
  matterId: string;
  matter: Matter;
}) {
  const [state, formAction, pending] = useActionState<TrademarkClearanceState, FormData>(
    generateTrademarkClearanceAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="matterId" value={matterId} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 0.8fr)",
          gap: "16px",
          alignItems: "start",
        }}
      >
        <article className="lx-card" style={{ display: "grid", gap: 14, padding: 18 }}>
          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Preliminary search findings — from your own USPTO TESS + web search
            </span>
            <textarea
              name="searchFindings"
              rows={10}
              required
              className="lx-input"
              style={{ resize: "vertical", fontFamily: "inherit" }}
              placeholder={
                "e.g. No live federal registrations found for identical marks in Class 25.\n" +
                "SIMILARMARK (U.S. Reg. No. 1234567) — registered for \"t-shirts\" in Class 25, owner Acme Apparel LLC, live.\n" +
                "No phonetic variants found. No common-law use found via web search."
              }
            />
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              This is the only source for every mark, registration number, owner, and status the
              draft cites — nothing here is invented.
            </p>
          </label>

          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Proposed filing basis
            </span>
            <select
              name="filingBasis"
              defaultValue={defaultFilingBasis(matter.filing_basis)}
              className="lx-input"
            >
              <option value="1(a) Use in Commerce">1(a) Use in Commerce</option>
              <option value="1(b) Intent-to-Use">1(b) Intent-to-Use</option>
            </select>
          </label>

          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Entity name (leave blank if none on file)
            </span>
            <input type="text" name="entityName" className="lx-input" placeholder="e.g. Acme Co. LLC" />
          </label>

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
            {pending ? "Drafting the clearance opinion…" : "Generate trademark clearance opinion"}
          </button>
        </article>

        <aside className="lx-voice" style={{ display: "grid", gap: 8, padding: 16 }}>
          <span className="lx-label" style={{ fontSize: 10 }}>
            Cited verbatim from the matter file
          </span>
          <div style={{ fontSize: 13, color: "var(--ink)" }}>
            <strong>Mark:</strong> {matter.mark_text ?? "— not on file —"}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink)" }}>
            <strong>Class(es):</strong>{" "}
            {matter.international_classes?.length
              ? matter.international_classes.join(", ")
              : "— not on file —"}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink)" }}>
            <strong>Goods/services:</strong> {matter.goods_services ?? "— not on file —"}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            This is a PRELIMINARY, pre-engagement knockout check — lighter than the comprehensive
            opinion letter, and never a substitute for it. Missing something above? Update it on
            the matter page before generating.
          </p>
        </aside>
      </div>
    </form>
  );
}
