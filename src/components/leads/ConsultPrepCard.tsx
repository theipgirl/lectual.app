import Link from "next/link";
import type { ConsultPrepCardData } from "@/lib/consult-prep/card-load";
import { RerunPrep } from "./RerunPrep";
import { TestBrief } from "./TestBrief";
import {
  CONSULT_PREP_BRIEF_MISSING,
  CONSULT_PREP_BRIEF_NOT_KEPT,
  CONSULT_PREP_BRIEF_UNAVAILABLE,
  CONSULT_PREP_COULDNT_LOAD,
  CONSULT_PREP_HEADING,
  CONSULT_PREP_VIEW_BRIEF,
} from "@/lib/ui/words";

/**
 * The lead page's Consult prep card: a status line, the brief behind a closed "View the brief", and (for the roles that may)
 * "Re-run prep", and for the owner "Send a test brief". No inputs: Lectual reads what it needs. The anchor and the tour hook each appear once, here.
 */
export function ConsultPrepCard({
  data,
  leadId,
  canRerun,
  adminTier,
  canTest = false,
}: {
  data: ConsultPrepCardData;
  leadId: string;
  canRerun: boolean;
  adminTier: boolean;
  /** S2c: the firm's real owner (never Lectual staff acting inside it): "Send a test brief". The action re-checks it. */
  canTest?: boolean;
}) {
  const { view, brief } = data;
  if (view.kind === "hidden") return null;
  return (
    <section id="prep-consult" className="lx-card lx-pad" data-tour="lead-prep" aria-labelledby="consult-prep-heading">
      <h2 id="consult-prep-heading" className="lx-h2" style={{ marginBottom: 8 }}>
        {CONSULT_PREP_HEADING}
      </h2>
      {view.kind === "unavailable" ? (
        <p className="lx-note" role="alert" style={{ margin: 0 }}>
          {CONSULT_PREP_COULDNT_LOAD}
        </p>
      ) : (
        <>
          {view.lines.map((line) => (
            <p key={line} className="lx-note" style={{ margin: "0 0 6px" }}>
              {line}
            </p>
          ))}
          {adminTier && view.kind === "not-prepared" && view.reason === "no-recipients" && (
            <p className="lx-note" style={{ margin: "0 0 6px" }}>
              <Link href="/dashboard/settings/team/">Settings → Team</Link>
            </p>
          )}
          {view.kind === "prepared" && brief.status === "ok" && (
            <details>
              <summary>{CONSULT_PREP_VIEW_BRIEF}</summary>
              <pre className="lx-note" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                {brief.text}
              </pre>
            </details>
          )}
          {view.kind === "prepared" && brief.status === "not-kept" && <p className="lx-note">{CONSULT_PREP_BRIEF_NOT_KEPT}</p>}
          {view.kind === "prepared" && brief.status === "missing" && <p className="lx-note">{CONSULT_PREP_BRIEF_MISSING}</p>}
          {view.kind === "prepared" && brief.status === "unavailable" && (
            <p className="lx-note" role="alert">
              {CONSULT_PREP_BRIEF_UNAVAILABLE}
            </p>
          )}
          {canRerun && <RerunPrep leadId={leadId} />}
          {canTest && <TestBrief leadId={leadId} />}
        </>
      )}
    </section>
  );
}
