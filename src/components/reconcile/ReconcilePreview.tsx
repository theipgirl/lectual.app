import { agreeingCount } from "@/lib/reconcile/decisions";
import type { Decisions, NotInLectualItem, ReconcileRow, ReconcileView } from "@/lib/reconcile/types";
import { ApplyBar } from "./ApplyBar";
import { ReconcileTable } from "./ReconcileTable";
import { NotInLectual, type CreatedLead } from "./NotInLectual";
import { LeftOutLists, SummaryStrip } from "./SummaryStrip";

export const EMPTY_TITLE = "No leads matched this sheet";

/**
 * Everything shown after a preview: the summary strip, then either the table with its bulk and
 * apply bar, or a sentence saying why there is no table (never a blank one), then the sheet rows
 * that were left out. Presentational; the screen owns the state.
 */
export function ReconcilePreview({
  view,
  decisions,
  accepted,
  busy,
  confirming,
  bulkMessage,
  onBulk,
  onAsk,
  onConfirm,
  onCancel,
  onAccept,
  onPick,
  onSkip,
  created = {},
  creatingKey = null,
  onCreate,
}: {
  view: ReconcileView;
  decisions: Decisions;
  accepted: number;
  busy: boolean;
  confirming: boolean;
  bulkMessage: string | null;
  onBulk?: () => void;
  onAsk?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  onAccept?: (row: ReconcileRow) => void;
  onPick?: (leadId: string, stageId: string) => void;
  onSkip?: (leadId: string) => void;
  created?: Readonly<Record<string, CreatedLead>>;
  creatingKey?: string | null;
  onCreate?: (item: NotInLectualItem) => void;
}) {
  return (
    <div className="rc-wrap">
      <SummaryStrip summary={view.summary} />
      {view.rows.length === 0 ? (
        <section className="lx-card lx-empty-card" aria-label="No leads">
          <h2 className="lx-h2" style={{ fontSize: 23 }}>
            {EMPTY_TITLE}
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
            onBulk={onBulk}
            onAsk={onAsk}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
          <ReconcileTable
            rows={view.rows}
            pickable={view.pickable}
            decisions={decisions}
            onAccept={onAccept}
            onPick={onPick}
            onSkip={onSkip}
          />
        </>
      )}
      <NotInLectual
        items={view.summary.notInLectual ?? []}
        total={view.summary.notInLectualTotal ?? (view.summary.notInLectual ?? []).length}
        created={created}
        busyKey={creatingKey}
        onCreate={onCreate}
      />
      <LeftOutLists summary={view.summary} />
    </div>
  );
}
