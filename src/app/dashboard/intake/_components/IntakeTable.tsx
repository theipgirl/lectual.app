"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { ReferralSource } from "@/lib/intake";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { pendingFor } from "@/lib/intake/needs-rebecca";
import type { IntakeRow, SortDir, SortKey } from "@/lib/intake/rows";
import { nextStepFor, stageLabelFor, touchStampFor } from "@/lib/intake/views";
import { showTimeChip } from "@/lib/intake/leads-view";
import { decisionOpen } from "@/lib/intake/stage-decision";
import { needsStageTitle } from "@/lib/intake/leads-view";
import type { IntakeTime } from "@/lib/time";
import TimeChip from "@/components/intake/TimeChip";
import OwnerCell from "./OwnerCell";
import TemperatureCell from "./TemperatureCell";
import NeedsRebeccaBadge from "./NeedsRebeccaBadge";
import AssistantChips from "./AssistantChips";
import { useColWidths } from "./useColWidths";
import { assistantColumnShown } from "@/lib/intake/assistant-column";
import { MENU_COL_WIDTH, NEXT_MIN_WIDTH, colWidth, tableMinWidth, visibleColumns, type ColKey } from "@/lib/intake/col-widths";
import "@/components/review/review.css";
import "@/components/review/review-sheet-edit.css";
import SourceCell from "./SourceCell";
import RowMenu from "./RowMenu";
import type { Lane } from "@/lib/leads/lane";
import type { CSSProperties } from "react";
import {
  LEADS_ASSISTANT_COLUMN,
  LEADS_COMPARE_OPEN,
  LEADS_CONTACT_COLUMN,
  LEADS_DUPLICATE,
  LEADS_MOVED_MARK,
  LEADS_MOVED_MARK_TITLE,
  LEADS_NEEDS_STAGE,
  LEADS_RESIZE_COLUMN,
  LEADS_SHOWING,
  LEADS_SHOW_MORE,
} from "@/lib/ui/words";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";
import { SHOW_STEP } from "@/lib/intake/paging";

/** The sort key and the words of each column. The Assistant activity column has no sort: it is not a value a person ranks by. */
const COLUMNS: Record<ColKey, { key: SortKey | null; label: string }> = {
  lead: { key: "lead", label: "Lead" },
  stage: { key: "stage", label: "Stage" },
  temp: { key: "temperature", label: "Temperature" },
  source: { key: "source", label: "Source" },
  owner: { key: "owner", label: "Owner" },
  assistant: { key: null, label: LEADS_ASSISTANT_COLUMN },
  touch: { key: "lastTouch", label: LEADS_CONTACT_COLUMN },
  next: { key: "notes", label: "Next step" },
};

/**
 * The Leads list. A row is at least one even height and grows only when a name needs a second line: the lead's FULL name (it
 * wraps, it is never cut) over its business (cut with a tooltip), the stage pill with the person's own markers ("Needs
 * attorney", "Needs a stage", "Possible duplicate"), the temperature pill, the source, the owner (only when somebody in view has
 * one), what the assistants did (only while somebody in view has something), the last contact in words ("Our turn · 16 Nov"), the
 * next step (two lines, "No activity yet" muted) and a "…" menu. Every column's right edge can be dragged (or moved with the arrow
 * keys) and the width is remembered for this person; the table scrolls inside its own box only if a person makes it wider than the
 * page, never the page. Under 640px a row is a card.
 *
 * `rows` is ONE PAGE of the sorted, filtered list; `total` is the whole filtered list and `left` what the page leaves out.
 */
export default function IntakeTable({
  rows,
  total,
  left,
  setLabel,
  hasOwnerColumn,
  members,
  stages,
  sortKey,
  sortDir,
  now,
  pendingLeadId,
  errors,
  time,
  pendingApprovals,
  notesUnavailable,
  duplicates = {},
  movedOut,
  onSort,
  onSetLane,
  onAssign,
  onSetSource,
  onMoveStage,
  onShowMore,
  onClearFilters,
  emptyAction,
  anyLeads,
  onCompare,
}: {
  rows: IntakeRow[];
  total: number;
  left: number;
  setLabel: string;
  hasOwnerColumn: boolean;
  members: MemberIdentity[];
  /** Stages a lead can be moved to from the row menu. */
  stages: Stage[];
  sortKey: SortKey;
  sortDir: SortDir;
  now: Date;
  pendingLeadId: string | null;
  errors: Record<string, string>;
  time: IntakeTime | null;
  pendingApprovals?: LeadPendingApprovals;
  notesUnavailable?: boolean;
  duplicates?: Record<string, DuplicateOf>;
  /** Leads moved this session out of the set they were listed in: a quiet "Moved" mark. */
  movedOut?: ReadonlySet<string>;
  onSort: (key: SortKey) => void;
  onSetLane: (leadId: string, lane: Lane | null) => void;
  onAssign: (leadId: string, userId: string | null) => void;
  onSetSource: (leadId: string, source: ReferralSource | null) => void;
  onMoveStage: (leadId: string, stageId: string) => void;
  onShowMore: () => void;
  onClearFilters?: () => void;
  emptyAction?: React.ReactNode;
  /** The firm has leads at all (else "No leads yet"). */
  anyLeads: boolean;
  /** Opens the compare panel for a possible duplicate (the trigger gets focus back when it closes). */
  onCompare?: (leadId: string, otherId: string, trigger: HTMLElement) => void;
}) {
  const router = useRouter();
  const showAssistant = assistantColumnShown(rows);
  const cols = visibleColumns({ owner: hasOwnerColumn, assistant: showAssistant });
  const { sizes, dragCol, startDrag, onKeyDown, reset } = useColWidths();
  const tableStyle = { "--rse-min": `${tableMinWidth(cols, sizes)}px` } as CSSProperties;

  return (
    <div className="rv-owner ix-sheet" data-leads-sheet>
      <div className="lx-card rse-card">
        <div className="rse-scroll ix-scroll">
          <table className="lx-tbl lx-stack rse-tbl ix-tbl" style={tableStyle}>
            <colgroup>
              {cols.map((c) => {
                const w = colWidth(sizes, c);
                return <col key={c} style={w ? { width: w } : undefined} />;
              })}
              <col style={{ width: MENU_COL_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                {cols.map((c) => {
                  const { key, label } = COLUMNS[c];
                  const active = key !== null && sortKey === key;
                  const w = colWidth(sizes, c);
                  return (
                    <th key={c} scope="col" data-col={c} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                      {key ? (
                        <button type="button" className="ix-sort" onClick={() => onSort(key)} aria-label={`Sort by ${label}`} data-on={active ? "" : undefined}>
                          {label}
                          {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                        </button>
                      ) : (
                        label
                      )}
                      <span
                        className={`rse-col-grip${dragCol === c ? " is-active" : ""}`}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={LEADS_RESIZE_COLUMN(label)}
                        tabIndex={0}
                        onPointerDown={startDrag(c)}
                        onKeyDown={onKeyDown(c)}
                        onDoubleClick={() => reset(c)}
                      />
                      {dragCol === c && <span className="rse-col-tip">{Math.round(w ?? NEXT_MIN_WIDTH)} px</span>}
                    </th>
                  );
                })}
                <th scope="col">
                  <span className="rse-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const lead = row.lead;
                const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
                const business = lead.mark_text?.trim() || lead.business_name?.trim() || "";
                const step = nextStepFor(row, now, { notesUnavailable });
                const touch = touchStampFor(row);
                const error = errors[lead.id];
                const pending = pendingLeadId === lead.id;
                const pendingDrafts = pendingFor(pendingApprovals, lead.id);
                const decision = decisionOpen(row.decision, lead.current_stage_id) ? row.decision : null;
                const dup = duplicates[lead.id];
                return (
                  <Fragment key={lead.id}>
                    <tr
                      className="ix-row"
                      data-lead-row={lead.id}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                        router.push(`/dashboard/leads/${lead.id}`);
                      }}
                      style={{ opacity: pending ? 0.55 : 1 }}
                    >
                      <td className="ix-lead-td" data-col="lead" data-primary="true">
                        <Link href={`/dashboard/leads/${lead.id}`} className="ix-name rse-client" title={name}>
                          {name}
                        </Link>
                        <span className="ix-subline">
                          <span className="ix-sub" title={business || undefined}>
                            {business || "—"}
                          </span>
                          {movedOut?.has(lead.id) && (
                            <span className="ix-marker ix-marker-quiet" data-moved title={LEADS_MOVED_MARK_TITLE}>
                              {LEADS_MOVED_MARK}
                            </span>
                          )}
                        </span>
                      </td>

                      <td data-col="stage" data-label="Stage">
                        <span className="ix-stage-line">
                          <span className={`ix-stage${row.stage ? "" : " ix-stage-warn"}`} title={row.stage?.name ?? "This lead's stage no longer exists"}>
                            {stageLabelFor(row.stage)}
                          </span>
                          <NeedsRebeccaBadge pending={pendingDrafts} />
                          {decision && (
                            <span className="ix-marker" data-needs-decision title={needsStageTitle(decision)}>
                              {LEADS_NEEDS_STAGE}
                            </span>
                          )}
                          {dup && (
                            <button
                              type="button"
                              className="ix-marker ix-marker-dup"
                              data-duplicate
                              aria-haspopup="dialog"
                              aria-label={LEADS_COMPARE_OPEN(name)}
                              title={duplicateTitle(dup)}
                              onClick={(event) => onCompare?.(lead.id, dup.leadId, event.currentTarget)}
                            >
                              {LEADS_DUPLICATE}
                            </button>
                          )}
                        </span>
                      </td>

                      <td data-col="temp" data-label="Temperature">
                        <TemperatureCell leadName={name} temperature={row.temperature} pending={pending} onSet={(lane) => onSetLane(lead.id, lane)} />
                      </td>

                      <td data-col="source" data-label="Source">
                        <SourceCell leadName={name} source={lead.referral_source} detail={lead.referral_detail} pending={pending} onSet={(source) => onSetSource(lead.id, source)} />
                      </td>

                      {hasOwnerColumn && (
                        <td data-col="owner" data-label="Owner">
                          <OwnerCell leadName={name} owner={row.owner} assignedTo={lead.assigned_to} members={members} pending={pending} onAssign={(userId) => onAssign(lead.id, userId)} />
                        </td>
                      )}

                      {showAssistant && (
                        <td className="ix-asst-td" data-col="assistant" data-label={LEADS_ASSISTANT_COLUMN}>
                          <div className="ix-asst-cell">
                            <AssistantChips row={row} />
                          </div>
                        </td>
                      )}

                      <td className="ix-touch" data-col="touch" data-label={LEADS_CONTACT_COLUMN} data-in={touch.waitingOnUs ? "" : undefined} data-touch={touch.state} title={touch.title}>
                        {touch.text}
                      </td>

                      <td className="rse-next-td" data-col="next" data-label="Next step">
                        <div className="ix-next-wrap">
                          <span className="ix-next" data-urgent={step.urgent ? "" : undefined} data-muted={step.muted ? "" : undefined} title={step.text}>
                            {step.text}
                          </span>
                          {showTimeChip(time?.byLeadId[lead.id], time?.running ?? null, lead.id, time === null) && (
                            <TimeChip leadId={lead.id} leadName={name} summary={time?.byLeadId[lead.id]} unavailable={time === null} running={time?.running ?? null} members={members} />
                          )}
                        </div>
                      </td>

                      <td data-col="menu" className="ix-menu-td">
                        <RowMenu lead={lead} name={name} stages={stages} members={members} running={time?.running ?? null} onMoveStage={onMoveStage} onAssign={onAssign} />
                      </td>
                    </tr>
                    {error && (
                      <tr>
                        <td colSpan={cols.length + 1} role="status" className="ix-err">
                          {error}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="lp-empty" data-empty={!anyLeads ? "none" : "filtered"}>
            {emptyAction}
            {onClearFilters && anyLeads && (
              <button type="button" className="lp-clear" onClick={onClearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="ix-foot">
          <span>{LEADS_SHOWING(rows.length, total)}</span>
          {left > 0 && (
            <button type="button" className="ix-more" onClick={onShowMore}>
              {LEADS_SHOW_MORE(Math.min(SHOW_STEP, left), left)}
            </button>
          )}
          <span className="lx-sr">{setLabel}</span>
        </div>
      </div>
    </div>
  );
}
