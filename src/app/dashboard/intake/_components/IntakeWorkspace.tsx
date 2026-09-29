"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { deriveTemperature, type Temperature } from "@/lib/intake";
import {
  DEFAULT_SORT,
  applyFilters,
  intakeHref,
  sortRows,
  type IntakeFilters,
  type IntakeGroup,
  type IntakeRow,
  type IntakeView,
  type IntakeViewState,
  type SortDir,
  type SortKey,
} from "@/lib/intake/rows";
import { topBarCounts, topBarLine } from "@/lib/intake/views";
import type { IntakeTime } from "@/lib/time";
import { IntakeTopBar } from "@/components/intake/IntakeTopBar";
import { assignLeadAction, moveStageAction, setTemperatureAction } from "../actions";
import AddLeadDialog from "./AddLeadDialog";
import IntakeBoard from "./IntakeBoard";
import IntakeControls from "./IntakeControls";
import IntakeTable from "./IntakeTable";
import { ImportIcon } from "./icons";
import { OUTLINE_BUTTON } from "./styles";

/** Columns whose interesting end is the HIGH one, so they open descending. */
const DESC_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(["temp", "reply", "lastTouch", "age", "nurture"]);

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
 * Owns four things and nothing else: the filters (mirrored into the URL so
 * `?source=UGW` and `?view=board&group=owner` are bookmarkable Monday views),
 * the view/grouping, the sort, and the optimistic write flow the temperature
 * chip, the owner menu and both board drops share.
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
  /** The server's render clock, so "Next step" says the same thing on both sides. */
  now: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [filters, setFilters] = useState(initialFilters);
  const [viewState, setViewState] = useState(initialViewState);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(DEFAULT_SORT);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const href = intakeHref(filters, viewState);

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

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const counts = useMemo(() => topBarCounts(filtered), [filtered]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DESC_FIRST.has(key) ? "desc" : "asc" },
    );
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

  const setTemperature = useCallback(
    (leadId: string, level: Temperature | null) => {
      runWrite(
        leadId,
        (row) => {
          const lead = { ...row.lead, temperature: level };
          // Clearing the override doesn't blank the chip — it falls back to the
          // derived value, which is exactly what the server will store too.
          return { ...row, lead, temperature: deriveTemperature(lead, stages, now) };
        },
        () => setTemperatureAction(leadId, level),
      );
    },
    [runWrite, stages, now],
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

  const moveStage = useCallback(
    (leadId: string, stageId: string) => {
      runWrite(
        leadId,
        (row) => {
          const lead = { ...row.lead, current_stage_id: stageId };
          return {
            ...row,
            lead,
            stage: stages.find((stage) => stage.id === stageId) ?? null,
            // Temperature rule 2 keys on the stage, so it has to be re-derived
            // with the lead's new home or the card would carry the old answer.
            temperature: deriveTemperature(lead, stages, now),
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
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 className="intake-serif" style={{ margin: 0, fontSize: 36, lineHeight: 1.05 }}>
              Leads
            </h1>
            <p
              style={{
                margin: "7px 0 0",
                fontSize: 13,
                color: "var(--ink2)",
                maxWidth: "68ch",
                lineHeight: 1.55,
              }}
            >
              {subline}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/dashboard/settings/integrations/lawmatics/" style={OUTLINE_BUTTON}>
              <ImportIcon />
              Import
            </Link>
            <AddLeadDialog stages={intakeStages} members={members} />
          </div>
        </div>

        <IntakeControls
          filters={filters}
          view={viewState.view}
          group={viewState.group}
          stages={intakeStages}
          members={members}
          visibleCount={filtered.length}
          currentHref={href}
          onFilters={setFilters}
          onView={(view: IntakeView) => setViewState((state) => ({ ...state, view }))}
          onGroup={(group: IntakeGroup) => setViewState((state) => ({ ...state, group }))}
        />

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
            onMoveStage={moveStage}
            onAssign={assign}
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
            onSort={toggleSort}
            onSetTemperature={setTemperature}
            onAssign={assign}
          />
        )}
      </div>
    </>
  );
}
