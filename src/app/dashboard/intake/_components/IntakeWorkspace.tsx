"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { ReferralSource } from "@/lib/intake";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { approvalsShown, filterNeedsRebecca, leadsNeedingApproval } from "@/lib/intake/needs-rebecca";
import {
  EMPTY_INTAKE_FILTERS,
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
import { leadsSubline, topBarCounts } from "@/lib/intake/views";
import { detailsNote } from "@/lib/intake/details-note";
import type { IntakeTime } from "@/lib/time";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { MoreMenu } from "@/components/list-page/MoreMenu";
import { leadsMoreItems } from "@/lib/intake/more-items";
import "@/components/list-page/list-page.css";
import { LEADS_NAME } from "@/lib/ui/words";
import { ViewToggle } from "@/components/ViewToggle";
import { assignLeadAction, bulkMoveStageAction, moveStageAction, setLaneAction, setSourceAction } from "../actions";
import { BULK_MOVE_MAX, bulkMoveSummary } from "@/lib/pipeline/bulk-move";
import { decisionOpen } from "@/lib/intake/stage-decision";
import { stageCodeFor, stageLabelFor } from "@/lib/intake/views";
import type { Lane } from "@/lib/leads/lane";
import AddLeadDialog from "./AddLeadDialog";
import BulkMoveBar from "./BulkMoveBar";
import IntakeBoard from "./IntakeBoard";
import IntakeControls from "./IntakeControls";
import IntakeTable from "./IntakeTable";

/** How long the URL lags the controls, so typing in Search isn't one push per key. */
const URL_SYNC_DELAY_MS = 300;

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
 * The status counts ride in the header's sub-line, which is page data, so the header lives here too.
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
  stageDecisions,
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
  /**
   * Whether the Lawmatics-import stage flags were read. `ok`: rows carry their flag, the "Needs a stage decision"
   * filter and the column badges are offered. `unavailable`: none of that is drawn or applied (an unreadable list must
   * never filter to "no leads") and a one-line note says so. Absent: the same, without the note.
   */
  stageDecisions?: { status: "ok"; truncated: boolean } | { status: "unavailable" };
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
  const decisionAvailable = stageDecisions?.status === "ok";
  const href = intakeHref(
    {
      ...(approvalsShown(pendingApprovals) ? filters : { ...filters, needsRebecca: false }),
      agent: agentAvailable ? filters.agent : null,
      decision: decisionAvailable ? filters.decision : undefined,
    },
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
    () =>
      filterNeedsRebecca(
        applyFilters(rows, { ...filters, agent: agentAvailable ? filters.agent : null, decision: decisionAvailable ? filters.decision : undefined }),
        pendingApprovals,
        filters.needsRebecca,
      ),
    [rows, filters, pendingApprovals, agentAvailable, decisionAvailable],
  );
  // Leads still waiting for a stage decision, over the whole list (like the agent counts), only when the flags were read.
  const decisionCount = useMemo(
    () => (decisionAvailable ? rows.filter((row) => decisionOpen(row.decision, row.lead.current_stage_id)).length : null),
    [rows, decisionAvailable],
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

  /** The row after a person moved it: the one patch the drag, the menu and the bulk move all share. */
  const movedRow = useCallback(
    (row: IntakeRow, stageId: string): IntakeRow => {
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
    [stages, now],
  );

  const moveStage = useCallback(
    (leadId: string, stageId: string) => {
      runWrite(leadId, (row) => movedRow(row, stageId), () => moveStageAction(leadId, stageId));
    },
    [runWrite, movedRow],
  );

  // ── bulk "Move to..." ───────────────────────────────────────────────────────
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  const toggleSelect = useCallback((leadId: string) => {
    setBulkMessage(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const bulkMove = useCallback(
    (stageId: string) => {
      const ids = rows.map((row) => row.lead.id).filter((id) => selected.has(id));
      if (ids.length === 0) return;
      setBulkMessage(null);
      setBulkPending(true);
      startTransition(async () => {
        let result: Awaited<ReturnType<typeof bulkMoveStageAction>>;
        try {
          result = await bulkMoveStageAction(ids, stageId);
        } catch {
          setBulkPending(false);
          setBulkMessage({ tone: "error", text: "Couldn't move these leads. Nothing was changed that you can see here; refresh to check." });
          return;
        }
        setBulkPending(false);
        if (!result.ok) {
          setBulkMessage({ tone: "error", text: result.error });
          return;
        }
        const moved = new Set(result.moved);
        setRows((current) => current.map((row) => (moved.has(row.lead.id) ? movedRow(row, stageId) : row)));
        // A lead that failed says why on its own card and stays ticked so it can be retried; the rest are done.
        setErrors((current) => ({ ...current, ...Object.fromEntries(result.failed.map((f) => [f.leadId, f.error])) }));
        setSelected(new Set(result.failed.map((f) => f.leadId)));
        const target = intakeStages.find((stage) => stage.id === stageId);
        setBulkMessage({
          tone: result.failed.length > 0 ? "warn" : "ok",
          text: bulkMoveSummary(target ? `${stageCodeFor(target)} · ${stageLabelFor(target)}` : "that stage", result),
        });
      });
    },
    [rows, selected, movedRow, intakeStages],
  );

  const board = viewState.view === "board";
  const router = useRouter();
  const note = detailsNote({ approvals: pendingApprovals, agentMoves, stageDecisions });
  const moreItems = leadsMoreItems({ showReconcile });
  const clearFilters = () => setFilters(() => ({ ...EMPTY_INTAKE_FILTERS }));

  return (
    <div className="lp-root">
      <ListHeader title={LEADS_NAME} sub={leadsSubline(counts, { board, group: viewState.group })} />

      <ListToolbar
        search={{
          label: "Search leads",
          placeholder: "Name, mark, or note",
          value: filters.q,
          onChange: (q) => setFilters((current) => ({ ...current, q })),
          onClear: () => setFilters((current) => ({ ...current, q: "" })),
        }}
        toggle={<ViewToggle value={viewState.view} onChange={(view) => setViewState((state) => ({ ...state, view }))} />}
        more={<MoreMenu items={moreItems} />}
        primary={<AddLeadDialog stages={intakeStages} members={members} />}
      />

        <IntakeControls
          filters={filters}
          view={viewState.view}
          group={viewState.group}
          stages={intakeStages}
          members={members}
          visibleCount={filtered.length}
          needsRebeccaCount={needsRebeccaCount}
          agentMoveCounts={agentMoveCounts}
          decisionCount={decisionCount}
          currentHref={href}
          onFilters={setFilters}
          onGroup={(group: IntakeGroup) => setViewState((state) => ({ ...state, group }))}
        />

        {note && (
          <p role="status" className="lp-note" data-details-note>
            <span>{note.text}</span>
            <button type="button" className="lp-btn" onClick={() => router.refresh()}>
              Refresh
            </button>
          </p>
        )}

        {board && (
          <BulkMoveBar
            selectedCount={selected.size}
            shownCount={sorted.length}
            stages={intakeStages}
            pending={bulkPending}
            message={bulkMessage}
            onSelectShown={() => {
              setBulkMessage(null);
              setSelected(new Set(sorted.slice(0, BULK_MOVE_MAX).map((row) => row.lead.id)));
            }}
            onClear={() => {
              setBulkMessage(null);
              setSelected(new Set());
            }}
            onMove={bulkMove}
          />
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
            selectedIds={selected}
            onToggleSelect={toggleSelect}
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
            onClearFilters={clearFilters}
            emptyAction={<AddLeadDialog stages={intakeStages} members={members} />}
          />
        )}
    </div>
  );
}
