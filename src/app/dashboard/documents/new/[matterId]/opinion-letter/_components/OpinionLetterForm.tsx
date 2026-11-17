// Ported from lectual (Document Center form); logic unchanged, restyled onto lx tokens.
"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui";
import { SAVING } from "@/lib/ui/words";
import "@/components/documents/documents.css";
import type { Matter } from "@/lib/matters";
import { generateOpinionLetterAction, type OpinionLetterState } from "../actions";

/**
 * Two-pane upload UI: LEFT = the TMTKO search upload + the details the
 * skill's HARD RULES require asking for once (honorific, entity name, mark
 * type) rather than inventing; RIGHT = the matter facts the letter will cite
 * verbatim, so staff can confirm them before spending an AI call.
 */
export default function OpinionLetterForm({ matterId, matter }: { matterId: string; matter: Matter }) {
  const [state, formAction, pending] = useActionState<OpinionLetterState, FormData>(
    generateOpinionLetterAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="matterId" value={matterId} />
      <div className="dl-two-pane">
        <article className="lx-card lx-pad dl-form-card">
          <label className="lx-field">
            <span className="lx-label">
              TMTKO search report (PDF or .docx)
            </span>
            <input
              type="file"
              name="upload"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
              className="lx-input"
            />
          </label>

          <label className="lx-field">
            <span className="lx-label">
              Mark type
            </span>
            <select name="markType" defaultValue="word mark" className="lx-input">
              <option value="word mark">Word mark</option>
              <option value="design mark">Design mark</option>
            </select>
          </label>

          <label className="lx-field">
            <span className="lx-label">
              Honorific (always confirm — never inferred)
            </span>
            <select name="honorific" defaultValue="" className="lx-input">
              <option value="">None — use full name</option>
              <option value="Mr.">Mr.</option>
              <option value="Ms.">Ms.</option>
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
            {pending ? SAVING : "Generate opinion letter"}
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
            Missing something above? Update it on the matter page before generating — the letter
            never invents a mark, class, or goods/services description.
          </p>
        </aside>
      </div>
    </form>
  );
}
