"use client";

import { Fragment, useEffect, useRef, useState } from "react";
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
import { MAX_COL, MENU_COL_WIDTH, MIN_COL, NEXT_MIN_WIDTH, colWidth, tableMinWidth, visibleColumns, type ColKey } from "@/lib/intake/col-widths";
import "@/components/review/review.css";
import "@/components/review/review-sheet-edit.css";
import SourceCell from "./SourceCell";
import RowMenu from "./RowMenu";
import type { Lane } from "@/lib/leads/lane";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { ShowingCount } from "@/components/ui/ShowingCount";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";
import {
  NEXT_STEP,
  OWNER_COLUMN,
  LEADS_ACTIONS_SR,
  LEADS_ASSISTANT_COLUMN,
  LEADS_COMPARE_OPEN,
  LEADS_CONTACT_COLUMN,
  LEADS_DUPLICATE,
  LEADS_MOVED_MARK,
  LEADS_MOVED_MARK_TITLE,
  LEADS_NEEDS_STAGE,
  LEADS_RESIZE_COLUMN, BLANK } from "@/lib/ui/words";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";

/** The sort key and the words of each column. The Assistant activity column has no sort: it is not a value a person ranks by. */
const COLUMNS: Record<ColKey, { key: SortKey | null; label: string }> = {
  lead: { key: "lead", label: "Lead" },
  stage: { key: "stage", label: "Stage" },
  temp: { key: "temperature", label: "Temperature" },
  source: { key: "source", label: "Source" },
  owner: { key: "owner", label: OWNER_COLUMN },
  assistant: { key: null, label: LEADS_ASSISTANT_COLUMN },
  touch: { key: "lastTouch", label: LEADS_CONTACT_COLUMN },
  next: { key: "notes", label: NEXT_STEP },
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
  timeZone,
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
  timeZone?: string;
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
  const { sizes, drag, startDrag, onKeyDown, reset } = useColWidths();
  const dragCol = drag?.col ?? null;
  const minWidth = tableMinWidth(cols, sizes);
  // The card scrolls sideways inside itself by default (so the PAGE never does, whatever the columns add up to). Only after a
  // measurement shows the table fits does it switch to overflow visible, so a menu opened on the last row is never clipped and adds
  // no scrollbar. With no ResizeObserver it simply stays scrollable.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [needsScroll, setNeedsScroll] = useState(true);
  // The drawn width of each column, for the separator's aria-valuenow (the flexible Next step column has no fixed width).
  const [drawn, setDrawn] = useState<Partial<Record<ColKey, number>>>({});
  const colsKey = cols.join(",");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setNeedsScroll(minWidth > el.clientWidth);
      const next: Partial<Record<ColKey, number>> = {};
      for (const th of el.querySelectorAll<HTMLElement>("thead th[data-col]")) next[th.dataset.col as ColKey] = Math.round(th.getBoundingClientRect().width);
      setDrawn(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const th of el.querySelectorAll("thead th")) observer.observe(th);
    return () => observer.disconnect();
  }, [minWidth, colsKey]);

  return (
    <div className="rv-owner ix-sheet" data-leads-sheet>
      <SheetCard>
        <SheetScroll className="ix-scroll" ref={scrollRef} scroll={needsScroll}>
          <SheetTable className="ix-tbl" fixed minWidth={minWidth}>
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
                        <button type="button" className="sheet-sort ix-sort" onClick={() => onSort(key)} aria-label={`Sort by ${label}`} data-on={active ? "" : undefined}>
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
                        aria-valuenow={w ?? drawn[c] ?? NEXT_MIN_WIDTH}
                        aria-valuemin={MIN_COL}
                        aria-valuemax={MAX_COL}
                        aria-label={LEADS_RESIZE_COLUMN(label)}
                        tabIndex={0}
                        onPointerDown={startDrag(c)}
                        onKeyDown={onKeyDown(c)}
                        onDoubleClick={() => reset(c)}
                      />
                      {dragCol === c && <span className="rse-col-tip">{drag?.width ?? Math.round(w ?? drawn[c] ?? NEXT_MIN_WIDTH)} px</span>}
                    </th>
                  );
                })}
                <th scope="col">
                  <span className="rse-sr">{LEADS_ACTIONS_SR}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const lead = row.lead;
                const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
                const business = lead.mark_text?.trim() || lead.business_name?.trim() || "";
                const step = nextStepFor(row, now, { notesUnavailable, timeZone });
                const touch = touchStampFor(row, { now, timeZone });
                const error = errors[lead.id];
                const pending = pendingLeadId === lead.id;
                const pendingDrafts = pendingFor(pendingApprovals, lead.id, row.stage);
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
                        <Link href={`/dashboard/leads/${lead.id}`} className="ix-name sheet-link" title={name}>
                          {name}
                        </Link>
                        <span className="ix-subline">
                          <span className="ix-sub" title={business || undefined}>
                            {business || BLANK}
                          </span>
                          {movedOut?.has(lead.id) && (
                            <span className="lx-pill lx-pill-mute" data-moved title={LEADS_MOVED_MARK_TITLE}>
                              {LEADS_MOVED_MARK}
                            </span>
                          )}
                        </span>
                      </td>

                      <td data-col="stage" data-label="Stage">
                        <span className="ix-stage-line">
                          <Pill tone={row.stage ? MEANING_TONE.neutral : MEANING_TONE.needsPerson} wrap title={row.stage?.name ?? "This lead's stage no longer exists"}>
                            {stageLabelFor(row.stage)}
                          </Pill>
                          <NeedsRebeccaBadge pending={pendingDrafts} />
                          {decision && (
                            <span className="lx-pill lx-pill-warn lx-pill-wrap" data-needs-decision title={needsStageTitle(decision)}>
                              {LEADS_NEEDS_STAGE}
                            </span>
                          )}
                          {dup && (
                            <button
                              type="button"
                              className="lx-pill lx-pill-warn lx-pill-wrap ix-pill-btn"
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
                        <td data-col="owner" data-label={OWNER_COLUMN}>
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

                      <td className="rse-next-td" data-col="next" data-label={NEXT_STEP}>
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
                        <td colSpan={cols.length + 1} className="ix-err">
                          <div role="status">{error}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </SheetTable>
        </SheetScroll>

        {rows.length === 0 && (
          <div className="lx-state-card" data-empty={!anyLeads ? "none" : "filtered"}>
            {emptyAction}
            {onClearFilters && anyLeads && (
              <button type="button" className="lp-clear" onClick={onClearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="ix-foot">
          <ShowingCount shown={rows.length} total={total} onMore={left > 0 ? onShowMore : undefined} />
          <span className="lx-sr">{setLabel}</span>
        </div>
      </SheetCard>
    </div>
  );
}
