// Ported from lectual (Document Center form); logic unchanged, restyled onto lx tokens.
"use client";

import { useActionState } from "react";
import type { Matter } from "@/lib/matters";
import { generateOpinionLetterAction, type OpinionLetterState } from "../actions";

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
            <span className="lx-label" style={{ fontSize: 10 }}>
              Mark type
            </span>
            <select name="markType" defaultValue="word mark" className="lx-input">
              <option value="word mark">Word mark</option>
              <option value="design mark">Design mark</option>
            </select>
          </label>

          <label className="lx-field">
            <span className="lx-label" style={{ fontSize: 10 }}>
              Honorific (always confirm — never inferred)
            </span>
            <select name="honorific" defaultValue="" className="lx-input">
              <option value="">None — use full name</option>
              <option value="Mr.">Mr.</option>
              <option value="Ms.">Ms.</option>
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
            {pending ? "Assembling the letter…" : "Generate opinion letter"}
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
            Missing something above? Update it on the matter page before generating — the letter
            never invents a mark, class, or goods/services description.
          </p>
        </aside>
      </div>
    </form>
  );
}
