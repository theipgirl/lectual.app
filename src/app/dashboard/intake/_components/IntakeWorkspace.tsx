"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { ReferralSource } from "@/lib/intake";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { approvalsShown, filterNeedsRebecca } from "@/lib/intake/needs-rebecca";
import {
  EMPTY_INTAKE_FILTERS,
  applyFilters,
  filtersToQueryString,
  intakeHref,
  naturalDir,
  sortRows,
  type IntakeFilters,
  type IntakeGroup,
  type IntakeRow,
  type IntakeViewState,
  type SortKey,
} from "@/lib/intake/rows";
import { stageLabelFor } from "@/lib/intake/views";
import { detailsNote } from "@/lib/intake/details-note";
import { chipCountsWithin, leadsHeaderLine, ownerColumnShown } from "@/lib/intake/leads-view";
import { SET_LABEL, allOpenData, drawnSet, leavesSet, rowsInSet, setChips, type LostRead, type SetData } from "@/lib/intake/sets";
import { isPastFirstContact, type LeadSet } from "@/lib/intake/working";
import type { DuplicateOf } from "@/lib/intake/duplicates";
import { SHOW_STEP, nextShow, pageSlice } from "@/lib/intake/paging";
import { moveTargetStages } from "@/lib/intake/board-columns";
import { boardModel } from "@/lib/intake/board-columns";
import { hiddenSelectedCount, movableIds, selectShown, selectionKey } from "@/lib/intake/selection";
import type { IntakeTime } from "@/lib/time";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar } from "@/components/list-page/ListToolbar";
import { MoreMenu } from "@/components/list-page/MoreMenu";
import { leadsMoreItems } from "@/lib/intake/more-items";
import "@/components/list-page/list-page.css";
import "../leads.css";
import {
  LEADS_ASSIGNED_TO,
  LEADS_LOST_CUT,
  LEADS_LOST_UNAVAILABLE,
  LEADS_MOVED_TO,
  LEADS_NAME,
  LEADS_NO_MATCH_IN_SET,
  LEADS_SELECT,
  LEADS_SET_EMPTY,
  LEADS_WORKING_UNAVAILABLE,
  NO_LEADS_YET,
} from "@/lib/ui/words";
import { ViewToggle } from "@/components/ViewToggle";
import { assignLeadAction, bulkMoveStageAction, moveStageAction, setLaneAction, setSourceAction } from "../actions";
import { bulkMoveSummary } from "@/lib/pipeline/bulk-move";
import type { Lane } from "@/lib/leads/lane";
import AddLeadDialog from "./AddLeadDialog";
import BulkMoveBar from "./BulkMoveBar";
import IntakeBoard from "./IntakeBoard";
import IntakeControls from "./IntakeControls";
import IntakeTable from "./IntakeTable";

/** How long the URL lags the controls, so typing in Search isn't one push per key. */
const URL_SYNC_DELAY_MS = 300;

/**
 * Client orchestrator for /dashboard/intake: the filters, the set (Working, Event contacts, ...), the view and grouping,
 * the sort and the paging (all mirrored into the URL by history.replaceState, so every state is a link), and the
 * optimistic write flow the temperature pill, the "…" menu and both board drops share.
 *
 * Presentation only: every row was fetched and RLS-scoped by the server page, and every write goes back through a server
 * action that re-checks the caller's role. A refused write reverts the optimistic change and prints the action's message.
 *
 * Set membership is computed on the server and FROZEN for the life of the page: a lead moved here stays in the set it was
 * in (and, on the board, is pinned at the top of its new column and announced) until the page is reloaded.
 */
export default function IntakeWorkspace({
  rows: initialRows,
  stages,
  intakeStages,
  lostStages = [],
  members,
  initialFilters,
  initialViewState,
  time,
  pendingApprovals,
  showReconcile = false,
  agentMoves,
  stageDecisions,
  setData: setDataProp,
  lost = { status: "none" },
  lostView = false,
  lostFailed = false,
  lostCut = null,
  notesUnavailable = false,
  duplicates = {},
  now: nowIso,
}: {
  /** The rows of the server's set: the intake list, or the lost leads when `lostView`. */
  rows: IntakeRow[];
  stages: Stage[];
  intakeStages: Stage[];
  lostStages?: Stage[];
  members: MemberIdentity[];
  initialFilters: IntakeFilters;
  initialViewState: IntakeViewState;
  /** This week's time per lead plus the caller's running timer. Null: the time read FAILED. */
  time: IntakeTime | null;
  pendingApprovals?: LeadPendingApprovals;
  showReconcile?: boolean;
  agentMoves?: { status: "ok"; truncated: boolean } | { status: "unavailable" };
  stageDecisions?: { status: "ok"; truncated: boolean } | { status: "unavailable" };
  /** The sets (see sets.ts). Absent: every lead in the list is shown as All open and no note is drawn. */
  setData?: SetData;
  lost?: LostRead;
  lostView?: boolean;
  /** The Lost set was chosen and its read failed. */
  lostFailed?: boolean;
  /** The lost list is cut at its cap: how many are shown of how many exist. */
  lostCut?: { shown: number; total: number } | null;
  /** The latest-notes read failed: Next step says so instead of "No activity yet". */
  notesUnavailable?: boolean;
  /** Possible duplicates among the loaded open leads, by lead id (see duplicates.ts). */
  duplicates?: Record<string, DuplicateOf>;
  now: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState(initialFilters);
  const [viewState, setViewState] = useState(initialViewState);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const [colExtra, setColExtra] = useState<Record<string, number>>({});
  const [showEmpty, setShowEmpty] = useState(false);
  const [, startTransition] = useTransition();

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const setData = useMemo(() => setDataProp ?? allOpenData(initialRows, stages), [setDataProp, initialRows, stages]);
  const agentAvailable = agentMoves?.status === "ok";
  const decisionAvailable = stageDecisions?.status === "ok";
  const drawn: LeadSet = lostView ? "lost" : drawnSet(setData, viewState.set);
  const board = viewState.view === "board";

  const href = intakeHref(
    {
      ...(approvalsShown(pendingApprovals) ? filters : { ...filters, needsRebecca: false }),
      agent: agentAvailable ? filters.agent : null,
      decision: decisionAvailable ? filters.decision : undefined,
    },
    // The set the person CHOSE, not the one drawn: while the All-open fallback shows, the URL must not lock `set=open` in.
    viewState,
  );

  // The URL mirrors the state (history.replaceState, not a router push: the page re-reads a dozen things on a navigation).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => window.history.replaceState(null, "", href), URL_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [href]);

  // Anything that changes WHAT is shown puts the page back to the first 25 and clears the ticks.
  const showKey = JSON.stringify([drawn, filtersToQueryString(filters), viewState.view, viewState.group, viewState.sort]);
  const [seenShowKey, setSeenShowKey] = useState(showKey);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const selKey = selectionKey({ set: drawn, query: filtersToQueryString(filters), show: viewState.show, view: viewState.view, group: viewState.group });
  const [seenSelKey, setSeenSelKey] = useState(selKey);
  if (seenShowKey !== showKey) {
    setSeenShowKey(showKey);
    if (viewState.show !== SHOW_STEP) setViewState((s) => ({ ...s, show: SHOW_STEP }));
    setColExtra({});
  }
  if (seenSelKey !== selKey) {
    setSeenSelKey(selKey);
    if (selected.size > 0) setSelected(new Set());
    setBulkMessage(null);
  }

  const inSetRows = useMemo(() => rowsInSet(rows, setData, drawn), [rows, setData, drawn]);
  const chipCounts = useMemo(
    () => chipCountsWithin(inSetRows, { approvals: pendingApprovals, decisionsRead: decisionAvailable, agentRead: agentAvailable, duplicates }),
    [inSetRows, pendingApprovals, decisionAvailable, agentAvailable, duplicates],
  );
  const applyAll = useCallback(
    (list: IntakeRow[]) => {
      const kept = filterNeedsRebecca(
        applyFilters(list, { ...filters, agent: agentAvailable ? filters.agent : null, decision: decisionAvailable ? filters.decision : undefined }),
        pendingApprovals,
        filters.needsRebecca,
      );
      return filters.dup ? kept.filter((r) => !!duplicates[r.lead.id]) : kept;
    },
    [filters, pendingApprovals, agentAvailable, decisionAvailable, duplicates],
  );
  const filtered = useMemo(() => applyAll(inSetRows), [inSetRows, applyAll]);
  // Searching inside a set: how many matches All open has, offered as a link when that is more than this set shows.
  const allOpenMatches = useMemo(() => {
    if (filters.q.trim() === "" || drawn === "open" || drawn === "lost" || lostView) return null;
    const n = applyAll(rowsInSet(rows, setData, "open")).length;
    return n > filtered.length ? n : null;
  }, [filters.q, drawn, lostView, rows, setData, applyAll, filtered.length]);
  // Stage moves made on this page: a lead moved OUT of the set it was listed in keeps its row and gets a quiet "Moved" mark.
  const [movedIds, setMovedIds] = useState<string[]>([]);
  const movedOut = useMemo(() => {
    const out = new Set<string>();
    for (const id of movedIds) {
      const r = rows.find((x) => x.lead.id === id);
      if (!r) continue;
      const cat = stages.find((s) => s.id === r.lead.current_stage_id)?.category;
      if (leavesSet(drawn, cat, isPastFirstContact(r.lead.current_stage_id, stages))) out.add(id);
    }
    return out;
  }, [movedIds, rows, stages, drawn]);
  const { sort } = viewState;
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const page = useMemo(() => pageSlice(sorted, viewState.show), [sorted, viewState.show]);
  const rowById = useCallback((id: string) => rows.find((r) => r.lead.id === id), [rows]);

  const columnStages = lostView ? lostStages : intakeStages;
  // The stage board ALWAYS ends with a Long-Term Nurture column (not in the Nurture set, which draws it already, and not
  // in the Lost set, whose rows come from a different read): the nurture leads, with the same filters and sort.
  const nurtureStage = useMemo(() => intakeStages.find((s) => s.category === "nurture") ?? null, [intakeStages]);
  const nurtureColumn = useMemo(() => {
    if (!board || viewState.group !== "stage" || lostView || drawn === "nurture" || !nurtureStage) return null;
    const mine = rows.filter((r) => stages.find((s) => s.id === r.lead.current_stage_id)?.category === "nurture");
    return { rows: sortRows(applyAll(mine), sort.key, sort.dir), stage: nurtureStage };
  }, [board, viewState.group, lostView, drawn, nurtureStage, rows, stages, applyAll, sort]);
  // Lost stages are offered as a destination ONLY while the Lost set is shown (so a lead can be moved back out). Elsewhere,
  // moving a lead to Lost happens on the lead page or the weekly review, as before.
  const moveStages = useMemo(() => moveTargetStages(intakeStages, lostStages, lostView), [intakeStages, lostStages, lostView]);
  const model = useMemo(
    () => boardModel({ rows: sorted, stages: columnStages, members, group: viewState.group, pinned, extra: colExtra, showEmpty, nurture: nurtureColumn }),
    [sorted, columnStages, members, viewState.group, pinned, colExtra, showEmpty, nurtureColumn],
  );
  const renderedIds = useMemo(() => (board ? model.renderedIds : page.shown.map((r) => r.lead.id)), [board, model, page]);
  const ownerColumn = ownerColumnShown(sorted);

  function toggleSort(key: SortKey) {
    setViewState((state) => ({
      ...state,
      sort: state.sort.key === key ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: naturalDir(key) },
    }));
  }

  const runWrite = useCallback(
    (leadId: string, patch: (row: IntakeRow) => IntakeRow, act: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) => {
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
        } else onOk?.();
      });
    },
    [rows],
  );

  const setLane = useCallback(
    (leadId: string, lane: Lane | null) => {
      runWrite(
        leadId,
        (row) => {
          const lead = { ...row.lead, lane, lane_set_by: lane ? (row.lead.lane_set_by ?? "you") : null, lane_set_at: lane ? nowIso : null };
          return { ...row, lead, temperature: effectiveTemperature(lead, stages, now, row.facts) };
        },
        () => setLaneAction(leadId, lane),
      );
    },
    [runWrite, stages, now, nowIso],
  );

  const pin = useCallback((ids: string[]) => setPinned((p) => [...ids, ...p.filter((x) => !ids.includes(x))]), []);
  const nameOf = (id: string) => {
    const r = rows.find((x) => x.lead.id === id);
    return r ? `${r.lead.first_name} ${r.lead.last_name}`.trim() || r.lead.email : "Lead";
  };

  const assign = useCallback(
    (leadId: string, userId: string | null) => {
      const who = userId ? (members.find((m) => m.userId === userId)?.displayName ?? "a teammate") : "nobody";
      runWrite(
        leadId,
        (row) => ({ ...row, lead: { ...row.lead, assigned_to: userId }, owner: userId ? (members.find((m) => m.userId === userId) ?? null) : null }),
        () => assignLeadAction(leadId, userId),
        () => {
          pin([leadId]);
          setAnnounce(LEADS_ASSIGNED_TO(nameOf(leadId), who));
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runWrite, members, pin, rows],
  );

  const setSource = useCallback(
    (leadId: string, source: ReferralSource | null) => {
      runWrite(leadId, (row) => ({ ...row, lead: { ...row.lead, referral_source: source } }), () => setSourceAction(leadId, source));
    },
    [runWrite],
  );

  const movedRow = useCallback(
    (row: IntakeRow, stageId: string): IntakeRow => {
      const lead = { ...row.lead, current_stage_id: stageId };
      return { ...row, agentMove: undefined, lead, stage: stages.find((s) => s.id === stageId) ?? null, temperature: effectiveTemperature(lead, stages, now, row.facts) };
    },
    [stages, now],
  );

  const moveStage = useCallback(
    (leadId: string, stageId: string) => {
      const target = stages.find((s) => s.id === stageId);
      runWrite(leadId, (row) => movedRow(row, stageId), () => moveStageAction(leadId, stageId), () => {
        pin([leadId]);
        setMovedIds((m) => (m.includes(leadId) ? m : [...m, leadId]));
        setAnnounce(LEADS_MOVED_TO(nameOf(leadId), target ? stageLabelFor(target) : "that stage"));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runWrite, movedRow, stages, pin, rows],
  );

  const toggleSelect = useCallback((leadId: string) => {
    setBulkMessage(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, [setBulkMessage, setSelected]);

  const bulkMove = useCallback(
    (stageId: string) => {
      // Only ticked cards that are ON SCREEN are sent.
      const ids = movableIds(selected, renderedIds);
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
        pin(result.moved);
        setMovedIds((m) => [...m, ...result.moved.filter((id) => !m.includes(id))]);
        setErrors((current) => ({ ...current, ...Object.fromEntries(result.failed.map((f) => [f.leadId, f.error])) }));
        setSelected(new Set(result.failed.map((f) => f.leadId)));
        const target = stages.find((s) => s.id === stageId);
        setBulkMessage({ tone: result.failed.length > 0 ? "warn" : "ok", text: bulkMoveSummary(target ? stageLabelFor(target) : "that stage", result) });
      });
    },
    [selected, renderedIds, movedRow, stages, pin],
  );

  const router = useRouter();
  const note = detailsNote({
    approvals: pendingApprovals,
    agentMoves,
    stageDecisions,
    notes: notesUnavailable ? { status: "unavailable" } : null,
    time: time === null ? { status: "unavailable" } : null,
    extra: setData.degraded.map((d) => (d === "booth" ? "event list" : d)),
  });
  const moreItems = leadsMoreItems({ showReconcile });
  const clearFilters = () => setFilters(() => ({ ...EMPTY_INTAKE_FILTERS }));
  const filtersActive = filtersToQueryString(filters) !== "";
  const label = SET_LABEL[drawn];
  const chips = setChips(setData, lost, drawn);
  const setHref = (set: LeadSet) => intakeHref({ ...EMPTY_INTAKE_FILTERS }, { ...viewState, set, show: SHOW_STEP });
  const anyLeads = setData.counts.open + setData.counts.nurture > 0 || lost.status === "ok";

  const emptyContent = !anyLeads ? (
    <>
      <p style={{ margin: 0 }}>{NO_LEADS_YET}</p>
      <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <AddLeadDialog stages={intakeStages} members={members} />
        <Link href="/dashboard/forms/">Open your intake form</Link>
      </span>
    </>
  ) : filtersActive ? (
    <p style={{ margin: 0 }}>{LEADS_NO_MATCH_IN_SET(label)}</p>
  ) : (
    <p style={{ margin: 0 }}>{LEADS_SET_EMPTY(label)}</p>
  );

  return (
    <div className="lp-root">
      <ListHeader title={LEADS_NAME} sub={leadsHeaderLine(drawn, sorted)} />

      <ListToolbar
        search={{
          label: "Search leads",
          placeholder: "Name, mark, or note",
          value: filters.q,
          onChange: (q) => setFilters((current) => ({ ...current, q })),
          onClear: () => setFilters((current) => ({ ...current, q: "" })),
        }}
        toggle={
          <>
            <ViewToggle value={viewState.view} onChange={(view) => setViewState((state) => ({ ...state, view }))} />
            {board && (
              <button
                type="button"
                className="lp-btn"
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting((on) => !on);
                  setSelected(new Set());
                  setBulkMessage(null);
                }}
              >
                {LEADS_SELECT}
              </button>
            )}
          </>
        }
        more={<MoreMenu items={moreItems} />}
        primary={<AddLeadDialog stages={intakeStages} members={members} />}
      />

      <IntakeControls
        filters={filters}
        view={viewState.view}
        group={viewState.group}
        stages={columnStages}
        members={members}
        setChips={chips}
        counts={chipCounts}
        currentHref={href}
        setHref={setHref}
        lostView={lostView}
        showOwnerFilter={ownerColumn}
        onSet={(set) => setViewState((state) => ({ ...state, set, show: SHOW_STEP }))}
        onFilters={setFilters}
        onGroup={(group: IntakeGroup) => setViewState((state) => ({ ...state, group }))}
        allOpenMatches={allOpenMatches}
      />

      {setDataProp !== undefined && setData.status === "unavailable" && !lostView && (
        <p role="status" className="lp-note" data-working-unavailable>
          <span>{LEADS_WORKING_UNAVAILABLE}</span>
          <button type="button" className="lp-btn" onClick={() => router.refresh()}>
            Refresh
          </button>
        </p>
      )}
      {note && (
        <p role="status" className="lp-note" data-details-note>
          <span>{note.text}</span>
          <button type="button" className="lp-btn" onClick={() => router.refresh()}>
            Refresh
          </button>
        </p>
      )}
      {lostView && lostCut && (
        <p role="status" className="lp-note" data-lost-cut>
          <span>{LEADS_LOST_CUT(lostCut.shown, lostCut.total)}</span>
        </p>
      )}
      {lost.status === "unavailable" && lostView && (
        <p role="alert" className="lp-note" data-lost-unavailable>
          <span>{LEADS_LOST_UNAVAILABLE}</span>
        </p>
      )}

      <div className="ix-live" aria-live="polite" data-announce>
        {announce}
      </div>

      {board && selecting && (
        <BulkMoveBar
          selectedCount={movableIds(selected, renderedIds).length}
          hiddenCount={hiddenSelectedCount(selected, renderedIds)}
          shownCount={renderedIds.length}
          stages={moveStages}
          pending={bulkPending}
          message={bulkMessage}
          onSelectShown={() => {
            setBulkMessage(null);
            setSelected(new Set(selectShown(renderedIds)));
          }}
          onClear={() => {
            setBulkMessage(null);
            setSelected(new Set());
          }}
          onDone={() => {
            setSelecting(false);
            setSelected(new Set());
            setBulkMessage(null);
          }}
          onMove={bulkMove}
        />
      )}

      {lostFailed ? null : board ? (
        sorted.length === 0 ? (
          <div className="lp-empty" data-empty={!anyLeads ? "none" : "filtered"}>
            {emptyContent}
            {filtersActive && anyLeads && (
              <button type="button" className="lp-clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <IntakeBoard
            group={viewState.group}
            model={model}
            moveStages={moveStages}
            members={members}
            now={now}
            pendingLeadId={pendingId}
            errors={errors}
            time={time}
            pendingApprovals={pendingApprovals}
            rowById={rowById}
            showEmpty={showEmpty}
            onToggleEmpty={() => setShowEmpty((v) => !v)}
            onMoreInColumn={(key) => setColExtra((e) => ({ ...e, [key]: (e[key] ?? 0) + 15 }))}
            onMoveStage={moveStage}
            onAssign={assign}
            selecting={selecting}
            selectedIds={selected}
            onToggleSelect={toggleSelect}
            duplicates={duplicates}
            movedOut={movedOut}
          />
        )
      ) : (
        <IntakeTable
          rows={page.shown}
          total={page.total}
          left={page.left}
          setLabel={label}
          hasOwnerColumn={ownerColumn}
          members={members}
          stages={moveStages}
          sortKey={sort.key}
          sortDir={sort.dir}
          now={now}
          pendingLeadId={pendingId}
          errors={errors}
          time={time}
          pendingApprovals={pendingApprovals}
          notesUnavailable={notesUnavailable}
          duplicates={duplicates}
          movedOut={movedOut}
          onSort={toggleSort}
          onSetLane={setLane}
          onAssign={assign}
          onSetSource={setSource}
          onMoveStage={moveStage}
          onShowMore={() => setViewState((s) => ({ ...s, show: nextShow(s.show) }))}
          onClearFilters={filtersActive ? clearFilters : undefined}
          emptyAction={emptyContent}
          anyLeads={anyLeads}
        />
      )}
    </div>
  );
}
