import { PageHeader } from "@/components/ui/PageHeader";
import { LEADS_LOAD_FAILED_BODY, LEADS_LOAD_FAILED_TITLE, INTAKE_NAME, NO_LEAD_STAGES } from "@/lib/ui/words";
import { RefreshButton } from "@/components/ui/RefreshButton";

/** A card in the shared state-card look: the failed-read and no-stages states both use it. */
function LeadsNotice({ title, body, kind }: { title: string; body: string; kind: "failed" | "no-stages" }) {
  return (
    <div className="lp-root" data-leads-notice={kind}>
      <PageHeader title={INTAKE_NAME} sub={title} />
      <div className="lx-card lx-state-card" role={kind === "failed" ? "alert" : undefined}>
        <h2 className="lx-h2">{title}</h2>
        <p className="lx-note">{body}</p>
        {kind === "failed" ? <RefreshButton /> : null}
      </div>
    </div>
  );
}

/**
 * The lead read failed. A fixed sentence, never the error's own text, and never an empty list: the
 * cause goes to the server log only (the page does that).
 */
export function LeadsLoadFailed() {
  return <LeadsNotice kind="failed" title={LEADS_LOAD_FAILED_TITLE} body={LEADS_LOAD_FAILED_BODY} />;
}

/** The firm has no lead stages, so there is nothing for a lead to sit in. */
export function NoLeadStages() {
  return <LeadsNotice kind="no-stages" title="No lead stages yet" body={NO_LEAD_STAGES} />;
}
