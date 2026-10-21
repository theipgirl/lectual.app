"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { ReferralSource } from "@/lib/intake";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { approvalsShown, filterNeedsRebecca, leadsNeedingApproval } from "@/lib/intake/needs-rebecca";
import {
  applyFilters,
  intakeHref,
  naturalDir,
  sortRows,
  type IntakeFilters,
  type IntakeGroup,
  type IntakeRow,
  type IntakeViewState,
  type SortKey,
} from "@/lib/intake/rows";
import { topBarCounts, topBarLine } from "@/lib/intake/views";
import type { IntakeTime } from "@/lib/time";
import { IntakeTopBar } from "@/components/intake/IntakeTopBar";
import { ViewToggle } from "@/components/ViewToggle";
import { assignLeadAction, moveStageAction, setLaneAction, setSourceAction } from "../actions";
import type { Lane } from "@/lib/leads/lane";
import AddLeadDialog from "./AddLeadDialog";
import IntakeBoard from "./IntakeBoard";
import IntakeControls from "./IntakeControls";
import IntakeSearch from "./IntakeSearch";
import IntakeTable from "./IntakeTable";
import { ImportIcon } from "./icons";
import { OUTLINE_BUTTON } from "./styles";

/** How long the URL lags the controls, so typing in Search isn't one push per key. */
const URL_SYNC_DELAY_MS = 300;

/** The sub-line under "Leads", per view (canvas 10a / 10b / 10c). */
const SUBLINE: Record<string, string> = {
  table:
    "Sorted by the last thing that happened, not by when the lead arrived. A row in burgundy has been waiting on us.",
  stage:
    "One column per intake stage, in the order this firm numbers them. Drag a card to move it; the stage menu on the card does the same thing without a mouse.",
  owner:
    "Unassigned is the first column on purpose — a lead nobody is carrying is the one thing this view exists to surface.",
};

/**
 * Client orchestrator for /intake (blueprint §11) — three views of one list.
 *
 * Owns four things and nothing else: the filters, the view/grouping and the sort
 * (all mirrored into the URL so `?source=UGW`, `?view=board&group=owner` and
 * `?sort=lead&dir=asc` are bookmarkable Monday views), and the optimistic write
 * flow the temperature chip, the owner menu and both board drops share.
 *
 * Presentation only — every row it renders was fetched and RLS-scoped by the
 * server component, and every write goes back through a server action that
 * re-checks the caller's role on every call. A refused write reverts the
 * optimistic change and prints the action's friendly message on that row,
 * rather than leaving the screen claiming something that didn't happen.
 *
 * It renders the top bar too, because the status line is page data — see
 * IntakeTopBar for why that lives here and not in the layout.
 */
export default function IntakeWorkspace({
  rows: initialRows,
  stages,
  intakeStages,
  members,
  initialFilters,
  initialViewState,
  time,
  pendingApprovals,
  showReconcile = false,
  agentMoves,
  now: nowIso,
}: {
  rows: IntakeRow[];
  /** Every stage the firm has — the temperature derivation reads the full set. */
  stages: Stage[];
  /** Just the intake ones, in order — the board columns and the stage filter. */
  intakeStages: Stage[];
  members: MemberIdentity[];
  initialFilters: IntakeFilters;
  initialViewState: IntakeViewState;
  /**
   * This week's time per lead plus the caller's running timer (§13.1). A
   * pass-through prop, never state: a router.refresh() after a start/stop has
   * to reach the chips, and `rows` is deliberately seeded once and owned by the
   * optimistic write path from then on. Null means the time read FAILED — the
   * chips then show an em dash rather than a confident "0m".
   */
  time: IntakeTime | null;
  /**
   * Drafts waiting in the approval queue, by lead. OPTIONAL and a pass-through
   * prop like `time`: absent renders nothing at all (not "zero"), `unavailable`
   * renders a notice, and only `ok` badges rows and enables the filter. See
   * src/lib/intake/needs-rebecca.ts.
   */
  pendingApprovals?: LeadPendingApprovals;
  /** Owner, admin and senior admin only: a link to the stage reconciliation screen. */
  showReconcile?: boolean;
  /**
   * Whether the Stage Keeper's recent moves were read. `ok`: rows carry their chips and the "Agent
   * moves" filter is offered. `unavailable`: no chip, the filter is neither offered nor applied (an
   * unreadable list must never filter to "no leads"), and a one-line note says so. Absent: the same
   * as unavailable, without the note.
   */
  agentMoves?: { status: "ok"; truncated: boolean } | { status: "unavailable" };
  /** The server's render clock, so "Next step" says the same thing on both sides. */
  now: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState(initialFilters);
  const [viewState, setViewState] = useState(initialViewState);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  // A bookmarked `needs=rebecca` is ignored while the queue isn't readable, and
  // its chip is hidden then, so it stays out of the URL (and "Save this view")
  // rather than riding along as a filter nobody can see or turn off.
  const agentAvailable = agentMoves?.status === "ok";
  const href = intakeHref(
    { ...(approvalsShown(pendingApprovals) ? filters : { ...filters, needsRebecca: false }), agent: agentAvailable ? filters.agent : null },
    viewState,
  );

  // The URL is a mirror of the state, never its source after first render:
  // filtering happens locally against rows already in the browser, and the
  // rewrite exists so the view can be bookmarked, shared, or reloaded.
  // Debounced so the search box doesn't rewrite the URL once per keystroke.
  //
  // history.replaceState, NOT router.replace: this page is force-dynamic, so a
  // router navigation re-runs the server component — listStages, the intake
  // read, the member directory and a 180-day activity sweep, four Supabase
  // round trips — every time someone pauses while typing in Search. And the
  // rows that came back would be thrown away, because `rows` is seeded from
  // the prop once and owned by the optimistic write path from then on. A
  // search-param-only rewrite is exactly what the App Router documents
  // history.replaceState for; it leaves the RSC payload alone.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => window.history.replaceState(null, "", href), URL_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [href]);

  const filtered = useMemo(
    // The agent filter is only applied when the moves were read: otherwise every row would lack a
    // chip and the list would filter to nobody.
    () => filterNeedsRebecca(applyFilters(rows, { ...filters, agent: agentAvailable ? filters.agent : null }), pendingApprovals, filters.needsRebecca),
    [rows, filters, pendingApprovals, agentAvailable],
  );
  const agentMoveCounts = useMemo(
    () => (agentAvailable ? { today: rows.filter((row) => row.agentMove?.today).length, week: rows.filter((row) => row.agentMove).length } : null),
    [rows, agentAvailable],
  );
  // The toggle is offered only when the queue was actually read; the count is
  // over leads in this list, not queue rows for leads that aren't in intake.
  const needsRebeccaCount = useMemo(() => {
    if (!approvalsShown(pendingApprovals)) return null;
    const needing = leadsNeedingApproval(pendingApprovals);
    return rows.filter((row) => needing.has(row.lead.id)).length;
  }, [rows, pendingApprovals]);
  const { sort } = viewState;
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const counts = useMemo(() => topBarCounts(filtered), [filtered]);

  // The sort rides in the view state, so it lands in the URL (and in "Save this
  // view") by the same debounced rewrite as the filters.
  function toggleSort(key: SortKey) {
    setViewState((state) => ({
      ...state,
      sort:
        state.sort.key === key
          ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: naturalDir(key) },
    }));
  }

  /**
   * One optimistic write path for every row action: patch the row, call the
   * action, and on refusal put the row back exactly as it was. `patch` returns
   * the new row so each caller decides what "updated" means for its own write.
   */
  const runWrite = useCallback(
    (
      leadId: string,
      patch: (row: IntakeRow) => IntakeRow,
      act: () => Promise<{ ok: true } | { ok: false; error: string }>,
    ) => {
      const prior = rows;
      setErrors((current) => ({ ...current, [leadId]: "" }));
      setPendingId(leadId);
      setRows((current) => current.map((row) => (row.lead.id === leadId ? patch(row) : row)));

      startTransition(async () => {
        const result = await act();
        setPendingId(null);
        if (!result.ok) {
          setRows(prior);
          setErrors((current) => ({ ...current, [leadId]: result.error }));
        }
      });
    },
    [rows],
  );

  // The Temperature chip's one write: set or clear the person's lane. The chip
  // flips at once and is put back, with the action's sentence under the row, if
  // the write is refused. The derived value and its reason are recomputed, so
  // clearing falls back to exactly what the server will show.
  const setLane = useCallback(
    (leadId: string, lane: Lane | null) => {
      runWrite(
        leadId,
        (row) => {
          const lead = {
            ...row.lead,
            lane,
            lane_set_by: lane ? (row.lead.lane_set_by ?? "you") : null,
            lane_set_at: lane ? nowIso : null,
          };
          return { ...row, lead, temperature: effectiveTemperature(lead, stages, now, row.facts) };
        },
        () => setLaneAction(leadId, lane),
      );
    },
    [runWrite, stages, now, nowIso],
  );

  const assign = useCallback(
    (leadId: string, userId: string | null) => {
      runWrite(
        leadId,
        (row) => ({
          ...row,
          lead: { ...row.lead, assigned_to: userId },
          owner: userId ? (members.find((member) => member.userId === userId) ?? null) : null,
        }),
        () => assignLeadAction(leadId, userId),
      );
    },
    [runWrite, members],
  );

  const setSource = useCallback(
    (leadId: string, source: ReferralSource | null) => {
      runWrite(
        leadId,
        (row) => ({ ...row, lead: { ...row.lead, referral_source: source } }),
        () => setSourceAction(leadId, source),
      );
    },
    [runWrite],
  );

  const moveStage = useCallback(
    (leadId: string, stageId: string) => {
      runWrite(
        leadId,
        (row) => {
          const lead = { ...row.lead, current_stage_id: stageId };
          // A person's move takes the agent's chip off the card (the server drops it the same way).
          return {
            ...row,
            agentMove: undefined,
            lead,
            stage: stages.find((stage) => stage.id === stageId) ?? null,
            // Temperature rule 2 (nurture stage) keys on the stage, so it has to be re-derived
            // with the lead's new home or the card would carry the old answer.
            temperature: effectiveTemperature(lead, stages, now, row.facts),
          };
        },
        () => moveStageAction(leadId, stageId),
      );
    },
    [runWrite, stages, now],
  );

  const board = viewState.view === "board";
  const subline = SUBLINE[board ? viewState.group : "table"];

  return (
    <>
      <IntakeTopBar eyebrow="Intake">
        {board && viewState.group === "owner"
          ? "Drag a card to reassign"
          : board
            ? "Drag a card to move it between stages"
            : topBarLine(counts)}
      </IntakeTopBar>

      <div className="intake-content">
        <div className="lx-page-head">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="lx-label">Intake</div>
            <h1 className="lx-h1">Leads</h1>
            <p className="lx-sub">{subline}</p>
          </div>
          <IntakeSearch value={filters.q} onChange={(q) => setFilters((current) => ({ ...current, q }))} />
          <ViewToggle value={viewState.view} onChange={(view) => setViewState((state) => ({ ...state, view }))} />
          {showReconcile && (
            <Link href="/dashboard/intake/reconcile/" style={OUTLINE_BUTTON}>
              Reconcile stages
            </Link>
          )}
          <Link href="/dashboard/settings/integrations/lawmatics/" style={OUTLINE_BUTTON}>
            <ImportIcon />
            Import
          </Link>
          <AddLeadDialog stages={intakeStages} members={members} />
        </div>

        <IntakeControls
          filters={filters}
          view={viewState.view}
          group={viewState.group}
          stages={intakeStages}
          members={members}
          visibleCount={filtered.length}
          needsRebeccaCount={needsRebeccaCount}
          agentMoveCounts={agentMoveCounts}
          currentHref={href}
          onFilters={setFilters}
          onGroup={(group: IntakeGroup) => setViewState((state) => ({ ...state, group }))}
        />

        {pendingApprovals?.status === "unavailable" && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink2)",
              background: "var(--warnbg)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            Couldn&rsquo;t reach the approval queue — approvals not shown.
          </p>
        )}

        {agentMoves?.status === "unavailable" && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink2)",
              background: "var(--warnbg)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            Agent moves couldn&rsquo;t be loaded, so the &ldquo;Moved by agent&rdquo; chips and the Agent moves filter are off.
          </p>
        )}

        {agentMoves?.status === "ok" && agentMoves.truncated && (
          <p role="status" className="lx-note" style={{ margin: 0 }}>
            There were more agent moves than could be read, so only the most recent are marked.
          </p>
        )}

        {board ? (
          <IntakeBoard
            group={viewState.group}
            rows={sorted}
            stages={intakeStages}
            members={members}
            now={now}
            pendingLeadId={pendingId}
            errors={errors}
            time={time}
            pendingApprovals={pendingApprovals}
            onMoveStage={moveStage}
            onAssign={assign}
            onSetSource={setSource}
          />
        ) : (
          <IntakeTable
            rows={sorted}
            totalCount={rows.length}
            members={members}
            sortKey={sort.key}
            sortDir={sort.dir}
            now={now}
            pendingLeadId={pendingId}
            errors={errors}
            time={time}
            pendingApprovals={pendingApprovals}
            onSort={toggleSort}
            onSetLane={setLane}
            onAssign={assign}
            onSetSource={setSource}
          />
        )}
      </div>
    </>
  );
}
