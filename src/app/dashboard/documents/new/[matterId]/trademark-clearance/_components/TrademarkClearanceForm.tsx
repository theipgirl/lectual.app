// Ported from lectual (Document Center form); logic unchanged, restyled onto lx tokens.
"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui";
import { SAVING } from "@/lib/ui/words";
import "@/components/documents/documents.css";
import type { Matter } from "@/lib/matters";
import { generateTrademarkClearanceAction, type TrademarkClearanceState } from "../actions";

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
      <div className="dl-two-pane">
        <article className="lx-card lx-pad dl-form-card">
          <label className="lx-field">
            <span className="lx-label">
              Preliminary search findings — from your own USPTO TESS + web search
            </span>
            <textarea
              name="searchFindings"
              rows={10}
              required
              className="lx-input"
              
              placeholder={
                "e.g. No live federal registrations found for identical marks in Class 25.\n" +
                "SIMILARMARK (U.S. Reg. No. 1234567) — registered for \"t-shirts\" in Class 25, owner Acme Apparel LLC, live.\n" +
                "No phonetic variants found. No common-law use found via web search."
              }
            />
            <p className="lx-note">
              This is the only source for every mark, registration number, owner, and status the
              draft cites — nothing here is invented.
            </p>
          </label>

          <label className="lx-field">
            <span className="lx-label">
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
            <span className="lx-label">
              Entity name (leave blank if none on file)
            </span>
            <input type="text" name="entityName" className="lx-input" placeholder="e.g. Acme Co. LLC" />
          </label>

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
            {pending ? SAVING : "Generate trademark clearance opinion"}
          </button>
        </article>

        <aside className="lx-voice lx-pad dl-facts">
          <span className="lx-label">
            Cited verbatim from the matter file
          </span>
          <div className="dl-fact">
            <strong>Mark:</strong> {matter.mark_text ?? "— not on file —"}
          </div>
          <div className="dl-fact">
            <strong>Class(es):</strong>{" "}
            {matter.international_classes?.length
              ? matter.international_classes.join(", ")
              : "— not on file —"}
          </div>
          <div className="dl-fact">
            <strong>Goods/services:</strong> {matter.goods_services ?? "— not on file —"}
          </div>
          <p className="lx-note">
            This is a PRELIMINARY, pre-engagement knockout check — lighter than the comprehensive
            opinion letter, and never a substitute for it. Missing something above? Update it on
            the matter page before generating.
          </p>
        </aside>
      </div>
    </form>
  );
}
