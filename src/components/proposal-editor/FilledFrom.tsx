import "@/app/dashboard/proposals/proposals.css";
import { MARK_KIND_LABEL } from "@/lib/proposals/types";
import {
  NO_LEAD_NOTE,
  NO_MARKS_NOTE,
  NOT_REVIEWED_NOTE,
  REVIEW_ON_LEAD,
  UNREADABLE_NOTE,
  type ConsultBrand,
  type ConsultSkip,
} from "@/lib/proposals/prefill";

/** The "Filled from" line: each source that was used, as `filledFromLine` words it. Nothing when nothing was chosen. */
export function FilledFrom({ line }: { line: string | null }) {
  if (!line) return null;
  return (
    <p className="lx-note pe-filled-from" style={{ margin: 0 }}>
      {line}
    </p>
  );
}

/** The one line that says why nothing was filled from the consult details. `none` (no consult recorded) has no line of its own: the consult strip says so. */
export function ConsultSkipNote({ skip, leadId }: { skip: ConsultSkip; leadId: string }) {
  if (skip === "none") return null;
  return (
    <p role="status" className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
      {skip === "not_reviewed" && (
        <>
          {NOT_REVIEWED_NOTE} <a href={`/dashboard/leads/${encodeURIComponent(leadId)}/`}>{REVIEW_ON_LEAD}</a>
        </>
      )}
      {skip === "unreadable" && UNREADABLE_NOTE}
      {skip === "no_marks" && NO_MARKS_NOTE}
      {skip === "no_lead" && NO_LEAD_NOTE}
    </p>
  );
}

/** What ticking "use the marks and classes" adds: each brand name with its marks, then its classes as the client will read them. */
export function ConsultFillList({ brands }: { brands: ConsultBrand[] }) {
  return (
    <ul className="pe-consult-fill">
      {brands.map((b) => (
        <li key={b.name}>
          <strong>{b.name}</strong>
          <span className="lx-note"> · {b.kinds.map((k) => MARK_KIND_LABEL[k]).join(" and ")}</span>
          {b.classes.length > 0 ? (
            <ul>
              {b.classes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <span className="lx-note"> · no classes were discussed</span>
          )}
        </li>
      ))}
    </ul>
  );
}
