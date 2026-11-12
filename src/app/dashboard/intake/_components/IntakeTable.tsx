"use client";

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
import { temperaturePill } from "@/lib/intake/temperature-pill";
import type { IntakeTime } from "@/lib/time";
import TimeChip from "@/components/intake/TimeChip";
import OwnerCell from "./OwnerCell";
import TemperatureCell from "./TemperatureCell";
import NeedsRebeccaBadge from "./NeedsRebeccaBadge";
import AgentMoveChip from "./AgentMoveChip";
import SourceCell from "./SourceCell";
import RowMenu from "./RowMenu";
import type { Lane } from "@/lib/leads/lane";
import { LEADS_DUPLICATE, LEADS_MOVED_MARK, LEADS_MOVED_MARK_TITLE, LEADS_NEEDS_STAGE, LEADS_SHOWING, LEADS_SHOW_MORE } from "@/lib/ui/words";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";
import { SHOW_STEP } from "@/lib/intake/paging";

const COLUMNS: Array<{ key: SortKey; label: string; col: string }> = [
  { key: "lead", label: "Lead", col: "lead" },
  { key: "stage", label: "Stage", col: "stage" },
  { key: "temperature", label: "Temperature", col: "temp" },
  { key: "source", label: "Source", col: "source" },
  { key: "owner", label: "Owner", col: "owner" },
  { key: "lastTouch", label: "Last touch", col: "touch" },
  { key: "notes", label: "Next step", col: "next" },
];

/**
 * The Leads list. Every row is one even height (two lines at most): the lead's name over its business, one stage pill on
 * one line, the temperature pill, the source, the owner (only when somebody in view has one), the last touch (date and an
 * arrow; the arrows' meaning is the cell's title and a hidden label), the next step (two lines, "No activity yet" muted)
 * and a "…" menu. The page scrolls; nothing here scrolls sideways at 1280. Under 640px a row is a card.
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
}) {
  const router = useRouter();
  const columns = COLUMNS.filter((c) => c.key !== "owner" || hasOwnerColumn);

  return (
    <div className="lp-panel" style={{ flex: "none" }}>
      <div className={`ix-table${hasOwnerColumn ? " ix-has-owner" : ""}`}>
        <div className="ix-head">
          {columns.map((c) => {
            const active = sortKey === c.key;
            return (
              <button key={c.key} type="button" onClick={() => onSort(c.key)} aria-label={`Sort by ${c.label}`} data-on={active ? "" : undefined}>
                {c.label}
                {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            );
          })}
          <span />
        </div>

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
          const pill = temperaturePill(row.temperature);
          return (
            <div key={lead.id}>
              <div
                className="ix-row"
                data-lead-row={lead.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                  router.push(`/dashboard/leads/${lead.id}`);
                }}
                style={{ opacity: pending ? 0.55 : 1, color: touch.waitingOnUs ? "var(--burg)" : "var(--ink)" }}
              >
                <div className="ix-cell" data-col="lead" data-primary="true">
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <Link href={`/dashboard/leads/${lead.id}`} className="ix-name" title={name}>
                      {name}
                    </Link>
                    <NeedsRebeccaBadge pending={pendingDrafts} />
                    <AgentMoveChip move={row.agentMove} />
                  </span>
                  <span className="ix-subline">
                    <span className="ix-sub" title={business || undefined}>
                      {business || "—"}
                    </span>
                    {duplicates[lead.id] && (
                      <a className="ix-marker ix-marker-dup" data-duplicate href={`/dashboard/leads/${duplicates[lead.id].leadId}/`} title={duplicateTitle(duplicates[lead.id])}>
                        {LEADS_DUPLICATE}
                      </a>
                    )}
                    {movedOut?.has(lead.id) && (
                      <span className="ix-marker ix-marker-quiet" data-moved title={LEADS_MOVED_MARK_TITLE}>
                        {LEADS_MOVED_MARK}
                      </span>
                    )}
                  </span>
                </div>

                <div className="ix-cell" data-col="stage" data-label="Stage">
                  <span className={`ix-stage${row.stage ? "" : " ix-stage-warn"}`} title={row.stage?.name ?? "This lead's stage no longer exists"}>
                    {stageLabelFor(row.stage)}
                  </span>{" "}
                  {decision && (
                    <span className="ix-marker" data-needs-decision title={needsStageTitle(decision)}>
                      {LEADS_NEEDS_STAGE}
                    </span>
                  )}
                  <span className="ix-phone-meta">
                    {pill && (
                      <span className="ix-temp" data-tone={pill.tone} data-suggested={pill.suggested ? "" : undefined} title={pill.title} aria-label={pill.ariaLabel}>
                        {pill.text}
                      </span>
                    )}
                    <span className="ix-touch" data-in={touch.waitingOnUs ? "" : undefined}>
                      {touch.text}
                    </span>
                  </span>
                </div>

                <div className="ix-cell" data-col="temp" data-label="Temperature">
                  <TemperatureCell leadName={name} temperature={row.temperature} pending={pending} onSet={(lane) => onSetLane(lead.id, lane)} />
                </div>

                <div className="ix-cell" data-col="source" data-label="Source">
                  <SourceCell leadName={name} source={lead.referral_source} detail={lead.referral_detail} pending={pending} onSet={(source) => onSetSource(lead.id, source)} />
                </div>

                {hasOwnerColumn && (
                  <div className="ix-cell" data-col="owner" data-label="Owner">
                    <OwnerCell leadName={name} owner={row.owner} assignedTo={lead.assigned_to} members={members} pending={pending} onAssign={(userId) => onAssign(lead.id, userId)} />
                  </div>
                )}

                <div className="ix-cell ix-touch" data-col="touch" data-label="Last touch" data-in={touch.waitingOnUs ? "" : undefined} title={touch.waitingOnUs ? "Waiting on us" : "Waiting on them"}>
                  <span className="lx-sr">{touch.waitingOnUs ? "Waiting on us: " : "Waiting on them: "}</span>
                  {touch.text}
                </div>

                <div className="ix-cell ix-next-wrap" data-col="next" data-label="Next step">
                  <span className="ix-next" data-urgent={step.urgent ? "" : undefined} data-muted={step.muted ? "" : undefined} title={step.text}>
                    {step.text}
                  </span>
                  {showTimeChip(time?.byLeadId[lead.id], time?.running ?? null, lead.id, time === null) && (
                    <TimeChip leadId={lead.id} leadName={name} summary={time?.byLeadId[lead.id]} unavailable={time === null} running={time?.running ?? null} members={members} />
                  )}
                </div>

                <div data-col="menu" style={{ display: "flex", justifyContent: "flex-end" }}>
                  <RowMenu lead={lead} name={name} stages={stages} members={members} running={time?.running ?? null} onMoveStage={onMoveStage} onAssign={onAssign} />
                </div>
              </div>
              {error && (
                <div role="status" className="ix-err">
                  {error}
                </div>
              )}
            </div>
          );
        })}

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
      </div>

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
  );
}
