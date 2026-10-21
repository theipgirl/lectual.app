import Link from "next/link";
import { isAlreadyThere } from "@/lib/reconcile/propose";
import type { Decisions, ReconcileRow } from "@/lib/reconcile/types";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { SourceCell } from "./SourceCell";

export const MATTERS_HREF = "/dashboard/matters/";

type Pickable = { id: string; name: string };

/**
 * The comparison table: one row per lead, with what each source says, the stage the sheet
 * proposes, and how sure that is. Presentational: the person's choices are held by the parent
 * (`decisions`) and nothing here writes anything.
 *
 * A row that needs a matter offers no Accept control at all. It links to the existing "Open a
 * matter" flow instead, and names the lead to pick there.
 */
export function ReconcileTable({
  rows,
  pickable,
  decisions,
  onAccept,
  onPick,
  onSkip,
}: {
  rows: readonly ReconcileRow[];
  /** The firm's stages a person may pick: none of them opens a matter. */
  pickable: readonly Pickable[];
  decisions: Decisions;
  onAccept?: (row: ReconcileRow) => void;
  onPick?: (leadId: string, stageId: string) => void;
  onSkip?: (leadId: string) => void;
}) {
  return (
    <div className="lx-card rc-scroll">
      <table className="lx-tbl rc-tbl">
        <thead>
          <tr>
            <th scope="col">Lead</th>
            <th scope="col">Current stage</th>
            <th scope="col">Sheet</th>
            <th scope="col">Lawmatics</th>
            <th scope="col">Email / calendar</th>
            <th scope="col">Proposed stage</th>
            <th scope="col">Confidence</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ReconcileRowView
              key={row.leadId}
              row={row}
              pickable={pickable}
              decision={decisions[row.leadId]}
              onAccept={onAccept}
              onPick={onPick}
              onSkip={onSkip}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function proposedCell(row: ReconcileRow) {
  const { proposal } = row;
  if (proposal.kind === "stage" && proposal.stage) return <b>{proposal.stage.name}</b>;
  if (proposal.kind === "needs_matter") return <span className="rc-state rc-state-matter">No stage: a client</span>;
  if (isAlreadyThere(proposal)) return <span className="rc-state rc-state-none">Already in this stage</span>;
  return <span className="rc-state rc-state-none">None proposed</span>;
}

function ReconcileRowView({
  row,
  pickable,
  decision,
  onAccept,
  onPick,
  onSkip,
}: {
  row: ReconcileRow;
  pickable: readonly Pickable[];
  decision: Decisions[string] | undefined;
  onAccept?: (row: ReconcileRow) => void;
  onPick?: (leadId: string, stageId: string) => void;
  onSkip?: (leadId: string) => void;
}) {
  const { proposal } = row;
  const needsMatter = proposal.kind === "needs_matter";
  const chosenName = decision ? pickable.find((s) => s.id === decision.stageId)?.name ?? proposal.stage?.name ?? null : null;
  return (
    <tr data-lead={row.leadId} data-kind={proposal.kind} data-confidence={proposal.confidence ?? "needs_matter"}>
      <td className="rc-name">
        <Link href={`/dashboard/leads/${row.leadId}/`}>{row.leadName}</Link>
      </td>
      <td>{row.currentStageName}</td>
      <td>
        <SourceCell source="sheet" signal={row.sheet} />
      </td>
      <td>
        <SourceCell source="lawmatics" signal={row.lawmatics} />
      </td>
      <td>
        <SourceCell source="email" signal={row.email} />
      </td>
      <td>
        {proposedCell(row)}
        <details className="rc-reasons">
          <summary>Why</summary>
          <ul>
            {proposal.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      </td>
      <td>
        <ConfidenceBadge proposal={proposal} />
      </td>
      <td className="rc-actions">
        {needsMatter ? (
          <div className="rc-cell">
            <div className="rc-controls">
              <Link href={MATTERS_HREF} className="lx-btn lx-btn-sec lx-btn-sm">
                Open a matter
              </Link>
              <Link href={`/dashboard/leads/${row.leadId}/`} className="lx-btn lx-btn-ghost lx-btn-sm">
                Open lead
              </Link>
            </div>
            <small>{`Pick ${row.leadName} in the Open a matter form.`}</small>
          </div>
        ) : (
          <div>
            <div className="rc-controls">
              {proposal.kind === "stage" && (
                <button
                  type="button"
                  className={decision && !decision.picked ? "lx-btn lx-btn-pri lx-btn-sm" : "lx-btn lx-btn-sec lx-btn-sm"}
                  aria-pressed={!!decision && !decision.picked}
                  onClick={() => onAccept?.(row)}
                >
                  Accept
                </button>
              )}
              <select
                className="rc-select"
                aria-label={`Pick another stage for ${row.leadName}`}
                value={decision?.picked ? decision.stageId : ""}
                onChange={(e) => {
                  if (e.target.value) onPick?.(row.leadId, e.target.value);
                }}
              >
                <option value="">Pick another</option>
                {pickable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => onSkip?.(row.leadId)}>
                Skip
              </button>
            </div>
            {decision && chosenName ? (
              <div className="rc-chosen" data-decision="move">
                {`Will move to ${chosenName}`}
              </div>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}
