"use client";

import { useState, useTransition } from "react";
import { applyReconcileAction, previewReconcileAction } from "@/app/dashboard/intake/reconcile/actions";
import { acceptAgreeing, accept, acceptedCount, agreeingCount, movesFrom, pick, skip } from "@/lib/reconcile/decisions";
import { MAX_SHEET_BYTES } from "@/lib/intake/sheet-limits";
import type { ApplyResult, Decisions, PlanRow, ReconcileRow, ReconcileView } from "@/lib/reconcile/types";
import { ApplyBar, ResultPanel } from "./ApplyBar";
import { ReconcileTable } from "./ReconcileTable";
import { LeftOutLists, SummaryStrip } from "./SummaryStrip";
import { UploadPanel } from "./UploadPanel";

type Preview = { view: ReconcileView; plan: PlanRow[]; fingerprint: string };

/**
 * The interactive part of the screen. It holds the upload, the table and the person's decisions in
 * the browser; the two server actions do the reading and the writing, and both re-check who is asking.
 * Nothing is applied until the person confirms.
 */
export function ReconcileScreen() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, startTransition] = useTransition();

  function restart() {
    setPreview(null);
    setDecisions({});
    setBulkMessage(null);
    setConfirming(false);
    setResult(null);
    setError(null);
  }

  function onUpload(form: HTMLFormElement) {
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const file = data.get("sheet");
      if (file instanceof File && file.size > MAX_SHEET_BYTES) {
        setError("That file is larger than 5 MB. Export only the intake sheet as CSV and try again.");
        return;
      }
      try {
        const r = await previewReconcileAction(data);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setPreview({ view: r.view, plan: r.plan, fingerprint: r.fingerprint });
        setDecisions({});
        setBulkMessage(null);
        setResult(null);
      } catch {
        setError("Something went wrong reading that file. Nothing was changed. Try again.");
      }
    });
  }

  function onApply() {
    if (!preview) return;
    startTransition(async () => {
      try {
        setResult(await applyReconcileAction({ plan: preview.plan, fingerprint: preview.fingerprint, moves: movesFrom(decisions) }));
      } catch {
        setResult({ ok: false, error: "Something went wrong, so we can't tell what was moved. Check the leads before trying again." });
      }
      setConfirming(false);
    });
  }

  if (result && preview) {
    return <ResultPanel result={result} rows={preview.view.rows} onRestart={restart} />;
  }

  if (!preview) {
    return <UploadPanel busy={busy} error={error} onSubmit={onUpload} />;
  }

  const { view } = preview;
  const accepted = acceptedCount(decisions);
  return (
    <div className="rc-wrap">
      <SummaryStrip summary={view.summary} />
      {view.rows.length === 0 ? (
        <section className="lx-card lx-empty-card" aria-label="No leads">
          <h2 className="lx-h2" style={{ fontSize: 23 }}>
            No leads matched this sheet
          </h2>
          <p>There are no leads in intake to compare, and none of the sheet&apos;s rows matched a lead the app has.</p>
        </section>
      ) : (
        <>
          <ApplyBar
            agreeing={agreeingCount(view.rows)}
            accepted={accepted}
            busy={busy}
            confirming={confirming}
            bulkMessage={bulkMessage}
            onBulk={() => {
              const r = acceptAgreeing(decisions, view.rows);
              setDecisions(r.decisions);
              setBulkMessage(r.marked === 1 ? "Marked 1 row to move." : `Marked ${r.marked} rows to move.`);
            }}
            onAsk={() => setConfirming(true)}
            onConfirm={onApply}
            onCancel={() => setConfirming(false)}
          />
          <ReconcileTable
            rows={view.rows}
            pickable={view.pickable}
            decisions={decisions}
            onAccept={(row: ReconcileRow) => setDecisions((d) => accept(d, row))}
            onPick={(leadId, stageId) => setDecisions((d) => pick(d, leadId, stageId, view.pickable))}
            onSkip={(leadId) => setDecisions((d) => skip(d, leadId))}
          />
        </>
      )}
      <LeftOutLists summary={view.summary} />
      <div>
        <button type="button" className="lx-btn lx-btn-ghost" onClick={restart} disabled={busy}>
          Upload a different file
        </button>
      </div>
    </div>
  );
}
