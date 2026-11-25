"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { COL_ORDER, DEFAULT_COL_WIDTHS, MAX_COL, MENU_COL_WIDTH, MIN_COL, NEXT_MIN_WIDTH, type ColKey } from "@/lib/intake/col-widths";
import { ViewTable, type ListColumn } from "@/components/views/table/ViewTable";
import { ColumnMenu } from "@/components/views/layout/ColumnMenu";
import { SheetFactTd } from "@/components/review/SheetFactTd";
import type { FactCell } from "@/lib/review/sheet-cells";
import { LEADS_LIST_BUILTIN, drawnLeadColumns, type LeadListColumn } from "@/lib/leads/views";
import type { Layout, ViewKey } from "@/lib/views/layout/types";
import "@/components/review/review.css";
import "@/components/review/review-sheet-edit.css";
import SourceCell from "./SourceCell";
import RowMenu from "./RowMenu";
import type { Lane } from "@/lib/leads/lane";
import { SheetCard } from "@/components/ui/SheetTable";
import { ShowingCount } from "@/components/ui/ShowingCount";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";
import {
  LEADS_ACTIONS_SR,
  LEADS_COMPARE_OPEN,
  LEADS_DUPLICATE,
  LEADS_MOVED_MARK,
  LEADS_MOVED_MARK_TITLE,
  LEADS_NEEDS_STAGE,
  LEADS_RESIZE_COLUMN, BLANK } from "@/lib/ui/words";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";
import { leadLabel } from "@/lib/record-card/lead-label";
import type { IntakeCardData } from "@/lib/record-card/intake-cards";
import { NextStepLine, StagePick } from "@/components/record-card/controls";
import { SavedNote } from "@/components/ui/SavedNote";
import { RECORD_CARD_SAVED, recordCardOpenLabel } from "@/lib/ui/words";
import "@/components/record-card/record-card.css";

/** The sort key of each built-in column (its words come from the layout's columns, `LEADS_LIST_BUILTIN`). The Assistant activity column has no sort: it is not a value a person ranks by. A firm's own column has none either. */
const SORT_KEY: Record<ColKey, SortKey | null> = { lead: "lead", stage: "stage", temp: "temperature", source: "source", owner: "owner", assistant: null, touch: "lastTouch", next: "notes" };
const isBuiltin = (key: string): key is ColKey => (COL_ORDER as readonly string[]).includes(key);
const MENU_KEY = "menu";
const DEFAULT_LIST_COLUMNS: readonly LeadListColumn[] = LEADS_LIST_BUILTIN;
/** A firm's own column, until the layout sets a width. */
const FIRM_COLUMN_WIDTH = 140;

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
 *
 * Drawn through the shared `ViewTable` (editable views, step 6) with the firm's `leads_list` layout: its order, names, widths and hidden
 * columns, and the firm's own columns (read-only here: they are typed on the lead's card). An owner gets the column menu on each header.
 * Item L's own rule for the Owner and Assistant activity columns still decides whether they are drawn at all. A person's own dragged
 * widths (browser storage) beat the layout's width, which beats the default.
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
  cards,
  openHrefFor,
  savedId,
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
  columns = DEFAULT_LIST_COLUMNS,
  layout = null,
  layoutEdit = null,
  fieldMeta = {},
  firmCells = {},
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
  /** Sprint 10: what each role may do on each row, the open link and the next-step line. Absent: the plain list, as before. */
  cards?: Record<string, IntakeCardData>;
  openHrefFor?: (leadId: string) => string;
  savedId?: string | null;
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
  /** Every column this viewer may have, in default order (the built-ins and the firm's own). Absent: the built-ins. */
  columns?: readonly LeadListColumn[];
  /** The firm's saved `leads_list` layout (null: the standard columns). */
  layout?: Layout | null;
  /** Given only for an owner whose saved layout was read: the menu on each header. */
  layoutEdit?: { view: ViewKey; rev: number | null } | null;
  /** A firm column's kind and choices, by `cf:` key (for its header menu). */
  fieldMeta?: Record<string, { kind: string; options: readonly string[] }>;
  /** The firm columns' cells, by lead id then `cf:` key. */
  firmCells?: Record<string, Record<string, FactCell>>;
}) {
  const router = useRouter();
  const showAssistant = assistantColumnShown(rows);
  const drawn = drawnLeadColumns(columns, layout, { owner: hasOwnerColumn, assistant: showAssistant });
  const { sizes, drag, startDrag, onKeyDown, reset } = useColWidths();
  const dragCol = drag?.col ?? null;
  // The width a column is drawn at: this person's own dragged width, else the firm's layout width, else the default; null = flexible.
  const widthOf = (c: ListColumn): number | null => {
    if (c.key === MENU_KEY) return MENU_COL_WIDTH;
    if (isBuiltin(c.key)) return sizes[c.key] ?? c.width ?? DEFAULT_COL_WIDTHS[c.key];
    return c.width ?? FIRM_COLUMN_WIDTH;
  };
  const listColumns: ListColumn[] = [
    ...drawn.map((c): ListColumn => ({ key: c.key, label: c.label, width: c.width, pinned: c.key === "lead", kind: c.kind })),
    { key: MENU_KEY, label: LEADS_ACTIONS_SR },
  ];
  const minWidth = listColumns.reduce((sum, c) => sum + (widthOf(c) ?? NEXT_MIN_WIDTH), 0);
  // The card scrolls sideways inside itself by default (so the PAGE never does, whatever the columns add up to). Only after a
  // measurement shows the table fits does it switch to overflow visible, so a menu opened on the last row is never clipped and adds
  // no scrollbar. With no ResizeObserver it simply stays scrollable.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [needsScroll, setNeedsScroll] = useState(true);
  // The drawn width of each column, for the separator's aria-valuenow (the flexible Next step column has no fixed width).
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const colsKey = listColumns.map((c) => c.key).join(",");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setNeedsScroll(minWidth > el.clientWidth);
      const next: Record<string, number> = {};
      for (const th of el.querySelectorAll<HTMLElement>("thead th[data-col]")) next[th.dataset.col as string] = Math.round(th.getBoundingClientRect().width);
      setMeasured(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const th of el.querySelectorAll("thead th")) observer.observe(th);
    return () => observer.disconnect();
  }, [minWidth, colsKey]);

  const head = (c: ListColumn): ReactNode => {
    if (c.key === MENU_KEY) return <span className="rse-sr">{LEADS_ACTIONS_SR}</span>;
    const builtin = isBuiltin(c.key);
    const key = builtin ? SORT_KEY[c.key as ColKey] : null;
    const label = c.label;
    const active = key !== null && sortKey === key;
    const w = builtin ? widthOf(c) : null;
    const at = drawn.findIndex((x) => x.key === c.key);
    const prev = drawn[at - 1];
    const meta = fieldMeta[c.key];
    return (
      <>
        {key ? (
          <button type="button" className="sheet-sort ix-sort" onClick={() => onSort(key)} aria-label={`Sort by ${label}`} data-on={active ? "" : undefined}>
            {label}
            {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ) : (
          label
        )}
        {layoutEdit && (
          <ColumnMenu
            view={layoutEdit.view}
            rev={layoutEdit.rev}
            columnKey={c.key}
            label={label}
            pinned={c.pinned}
            allowAdd
            section="trademarks"
            prevKey={prev && !prev.pinned ? prev.key : null}
            nextKey={drawn[at + 1]?.key ?? null}
            firm={meta ? { kind: meta.kind, options: meta.options } : null}
          />
        )}
        {builtin && (
          <>
            <span
              className={`rse-col-grip${dragCol === c.key ? " is-active" : ""}`}
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={w ?? measured[c.key] ?? NEXT_MIN_WIDTH}
              aria-valuemin={MIN_COL}
              aria-valuemax={MAX_COL}
              aria-label={LEADS_RESIZE_COLUMN(label)}
              tabIndex={0}
              onPointerDown={startDrag(c.key as ColKey)}
              onKeyDown={onKeyDown(c.key as ColKey)}
              onDoubleClick={() => reset(c.key as ColKey)}
            />
            {dragCol === c.key && <span className="rse-col-tip">{drag?.width ?? Math.round(w ?? measured[c.key] ?? NEXT_MIN_WIDTH)} px</span>}
          </>
        )}
      </>
    );
  };

  const byId = new Map(rows.map((r) => [r.lead.id, r]));

  const cell = (rowRef: { key: string }, c: ListColumn): ReactNode => {
    const row = byId.get(rowRef.key)!;
    const lead = row.lead;
    const card = cards?.[lead.id];
    const openHref = openHrefFor?.(lead.id) ?? card?.openHref;
    const labelOf = leadLabel(lead);
    const name = labelOf.name;
    const pending = pendingLeadId === lead.id;
    switch (c.key) {
      case "lead": {
        const business = labelOf.sub ?? "";
        return (
          <td className="ix-lead-td" data-col="lead" data-primary="true">
            <Link href={openHref ?? `/dashboard/leads/${lead.id}`} scroll={card ? false : undefined} data-card-open={card ? "" : undefined} aria-label={card ? recordCardOpenLabel(name) : undefined} className="ix-name sheet-link" title={name}>
              {name}
            </Link>
            <span className="ix-subline">
              <span className="ix-sub" title={business || undefined}>
                {business || BLANK}
              </span>
              <SavedNote show={savedId === lead.id}>{RECORD_CARD_SAVED}</SavedNote>
              {movedOut?.has(lead.id) && (
                <span className="lx-pill lx-pill-mute" data-moved title={LEADS_MOVED_MARK_TITLE}>
                  {LEADS_MOVED_MARK}
                </span>
              )}
            </span>
          </td>
        );
      }
      case "stage": {
        const pendingDrafts = pendingFor(pendingApprovals, lead.id, row.stage);
        const decision = decisionOpen(row.decision, lead.current_stage_id) ? row.decision : null;
        const dup = duplicates[lead.id];
        return (
          <td data-col="stage" data-label={c.label}>
            <span className="ix-stage-line">
              {card && card.edits.stage ? (
                <StagePick
                  kind="lead"
                  id={lead.id}
                  name={name}
                  stage={{ id: lead.current_stage_id, name: stageLabelFor(row.stage), targets: stages.filter((s) => s.id !== lead.current_stage_id).map((s) => ({ id: s.id, name: stageLabelFor(s) })) }}
                  onPick={(stageId) => onMoveStage(lead.id, stageId)}
                />
              ) : (
                <Pill tone={row.stage ? MEANING_TONE.neutral : MEANING_TONE.needsPerson} wrap title={row.stage?.name ?? "This lead's stage no longer exists"}>
                  {stageLabelFor(row.stage)}
                </Pill>
              )}
              {card?.approvals ? (
                card.approvals.href ? (
                  <Link href={card.approvals.href === card.openHref && openHref ? openHref : card.approvals.href} className="lx-pill lx-pill-warn lx-pill-wrap rc-attn">
                    {card.approvals.text}
                  </Link>
                ) : (
                  <span className="lx-pill lx-pill-mute">{card.approvals.text}</span>
                )
              ) : (
                !card && <NeedsRebeccaBadge pending={pendingDrafts} />
              )}
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
        );
      }
      case "temp":
        return (
          <td data-col="temp" data-label={c.label}>
            <TemperatureCell leadName={name} temperature={row.temperature} pending={pending} canEdit={card ? card.edits.temperature : true} onSet={(lane) => onSetLane(lead.id, lane)} />
          </td>
        );
      case "source":
        return (
          <td data-col="source" data-label={c.label}>
            <SourceCell leadName={name} source={lead.referral_source} detail={lead.referral_detail} pending={pending} canEdit={card ? card.edits.source : true} onSet={(source) => onSetSource(lead.id, source)} />
          </td>
        );
      case "owner":
        return (
          <td data-col="owner" data-label={c.label}>
            <OwnerCell leadName={name} owner={row.owner} assignedTo={lead.assigned_to} members={members} pending={pending} canEdit={card ? card.edits.owner : true} onAssign={(userId) => onAssign(lead.id, userId)} />
          </td>
        );
      case "assistant":
        return (
          <td className="ix-asst-td" data-col="assistant" data-label={c.label}>
            <div className="ix-asst-cell">
              <AssistantChips row={row} />
            </div>
          </td>
        );
      case "touch": {
        const touch = touchStampFor(row, { now, timeZone });
        return (
          <td className="ix-touch" data-col="touch" data-label={c.label} data-in={touch.waitingOnUs ? "" : undefined} data-touch={touch.state} title={touch.title}>
            {touch.text}
          </td>
        );
      }
      case "next": {
        const step = nextStepFor(row, now, { notesUnavailable, timeZone });
        return (
          <td className="rse-next-td" data-col="next" data-label={c.label}>
            <div className="ix-next-wrap">
              {card && <NextStepLine kind="lead" id={lead.id} line={card.nextStep} dueIso={card.dueIso} text={card.bottom.nextStep} />}
              {/* Amber only on a person's own note; the sentences the page writes (waiting on, consult held) read the same on every row. */}
              <span className="ix-next" data-urgent={step.urgent && row.latestNote?.trim() ? "" : undefined} data-muted={step.muted ? "" : undefined} title={step.text}>
                {step.text}
              </span>
              {showTimeChip(time?.byLeadId[lead.id], time?.running ?? null, lead.id, time === null) && (
                <TimeChip leadId={lead.id} leadName={name} summary={time?.byLeadId[lead.id]} unavailable={time === null} running={time?.running ?? null} members={members} />
              )}
            </div>
          </td>
        );
      }
      case MENU_KEY:
        return (
          <td data-col="menu" className="ix-menu-td">
            <RowMenu card={card} openHref={openHref} lead={lead} name={name} stages={stages} members={members} running={time?.running ?? null} onMoveStage={onMoveStage} onAssign={onAssign} />
          </td>
        );
      default:
        // A firm column (`cf:<id>`): read-only here, typed on the lead's own card.
        return <SheetFactTd cell={firmCells[lead.id]?.[c.key]} label={c.label} />;
    }
  };

  return (
    <div className="rv-owner ix-sheet" data-leads-sheet>
      <SheetCard>
        <ViewTable
          columns={listColumns}
          rows={rows.map((r) => ({ key: r.lead.id }))}
          cell={cell}
          renderHead={head}
          headProps={(c) => ({
            "data-col": c.key === MENU_KEY ? undefined : c.key,
            "aria-sort": isBuiltin(c.key) && SORT_KEY[c.key] !== null && sortKey === SORT_KEY[c.key] ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
          })}
          tableClass="ix-tbl"
          fixed
          minWidth={minWidth}
          widthOf={widthOf}
          scrollProps={{ className: "ix-scroll", ref: scrollRef, scroll: needsScroll }}
          rowClass={() => "ix-row"}
          rowProps={(r) => {
            const lead = byId.get(r.key)!.lead;
            const card = cards?.[lead.id];
            const openHref = openHrefFor?.(lead.id) ?? card?.openHref;
            return {
              "data-lead-row": lead.id,
              onClick: (event) => {
                if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                router.push(openHref ?? `/dashboard/leads/${lead.id}`, card ? { scroll: false } : undefined);
              },
              style: { opacity: pendingLeadId === lead.id ? 0.55 : 1 },
            };
          }}
          afterRow={(r) => {
            const error = errors[r.key];
            return error ? (
              <tr>
                <td colSpan={listColumns.length} className="ix-err">
                  <div role="status">{error}</div>
                </td>
              </tr>
            ) : null;
          }}
        />

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
