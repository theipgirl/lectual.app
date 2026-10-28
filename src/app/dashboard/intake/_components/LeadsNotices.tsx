import { ListHeader } from "@/components/list-page/ListHeader";
import { LEADS_LOAD_FAILED_BODY, LEADS_LOAD_FAILED_TITLE, LEADS_NAME, NO_LEAD_STAGES } from "@/lib/ui/words";

/** A card in the shared list-page look: the failed-read and no-stages states both use it. */
function LeadsNotice({ title, body, kind }: { title: string; body: string; kind: "failed" | "no-stages" }) {
  return (
    <div className="lp-root" data-leads-notice={kind}>
      <ListHeader title={LEADS_NAME} sub={title} />
      <div className="lp-panel" style={{ flex: "none", padding: 26, gap: 8 }} role={kind === "failed" ? "alert" : undefined}>
        <h2 className="lx-h2" style={{ margin: 0, fontSize: 25 }}>
          {title}
        </h2>
        <p className="lx-note" style={{ margin: 0, maxWidth: "68ch" }}>
          {body}
        </p>
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
