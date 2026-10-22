import type { ApplyResult, ReconcileRow } from "@/lib/reconcile/types";

export const BULK_LABEL = "Accept all where two or more sources agree";

export function applyLabel(count: number): string {
  return count === 1 ? "Apply 1 move" : `Apply ${count} moves`;
}

/**
 * The bulk action and the apply button. The bulk action appears only when at least one row has a
 * two or more sources agreeing. Apply is disabled at zero, and asks for a confirmation that
 * names the count before anything runs.
 */
export function ApplyBar({
  agreeing,
  accepted,
  busy,
  confirming,
  bulkMessage,
  onBulk,
  onAsk,
  onConfirm,
  onCancel,
}: {
  agreeing: number;
  accepted: number;
  busy: boolean;
  confirming: boolean;
  bulkMessage: string | null;
  onBulk?: () => void;
  onAsk?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <section className="lx-card rc-bar" aria-label="Apply">
      <div className="rc-bar-group">
        {agreeing > 0 ? (
          <button type="button" className="lx-btn lx-btn-sec" onClick={onBulk} disabled={busy}>
            {BULK_LABEL}
          </button>
        ) : null}
        {bulkMessage ? (
          <span role="status" className="lx-note">
            {bulkMessage}
          </span>
        ) : null}
      </div>
      <div className="rc-bar-group">
        {confirming ? (
          <>
            <span role="alertdialog" aria-label="Confirm moves">
              {`Move ${accepted} ${accepted === 1 ? "lead" : "leads"} to the chosen stages? Moves are logged on each lead's timeline.`}
            </span>
            <button type="button" className="lx-btn lx-btn-pri" onClick={onConfirm} disabled={busy || accepted === 0}>
              {`Yes, ${applyLabel(accepted).toLowerCase()}`}
            </button>
            <button type="button" className="lx-btn lx-btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="lx-btn lx-btn-pri" onClick={onAsk} disabled={busy || accepted === 0}>
            {applyLabel(accepted)}
          </button>
        )}
      </div>
    </section>
  );
}

/** What happened after Apply: totals, each lead's outcome, and the stale-plan and failure sentences. */
export function ResultPanel({
  result,
  rows,
  onRestart,
}: {
  result: ApplyResult;
  rows: readonly ReconcileRow[];
  onRestart?: () => void;
}) {
  const names = new Map(rows.map((r) => [r.leadId, r.leadName]));
  const outcomes = result.ok ? result.outcomes : (result.outcomes ?? []);
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label="Result">
      {result.ok ? (
        <>
          <h2 className="lx-h2" style={{ fontSize: 23 }}>
            Done
          </h2>
          <p>
            {`${result.totals.moved} moved, ${result.totals.already} already there, ${result.totals.failed} failed. Moves are logged on each lead's timeline.`}
          </p>
        </>
      ) : (
        <>
          <h2 className="lx-h2" style={{ fontSize: 23 }}>
            {result.stale ? "This plan is out of date" : "Nothing was moved"}
          </h2>
          <p role="alert" className="lx-banner lx-banner-risk">
            {result.error}
          </p>
        </>
      )}
      {outcomes.length > 0 ? (
        <ul className="rc-out">
          {outcomes.map((o) => (
            <li key={o.leadId} data-outcome={o.status}>
              <b>{names.get(o.leadId) ?? "A lead"}</b>
              {": "}
              {o.status === "moved" ? `moved to ${o.stageName}` : o.status === "already" ? `already in ${o.stageName}` : o.error}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <button type="button" className="lx-btn lx-btn-sec" onClick={onRestart}>
          Upload the sheet again
        </button>
      </div>
    </section>
  );
}
