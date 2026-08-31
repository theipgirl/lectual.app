import Link from "next/link";
import { redirect } from "next/navigation";

import { AttentionStrip } from "@/components/AttentionStrip";
import { CalendarGrid } from "@/components/CalendarGrid";
import { CalendarLegend } from "@/components/CalendarLegend";
import { Card } from "@/components/Card";
import { DeadlineList, type DeadlineListItem } from "@/components/DeadlineList";
import { EmptyState } from "@/components/EmptyState";
import { PracticeTabs } from "@/components/PracticeTabs";
import { Shell } from "@/components/Shell";
import { StageLane } from "@/components/StageLane";
import { UnplacedLane } from "@/components/UnplacedLane";
import { UpNext } from "@/components/UpNext";
import type { MatterCardItem } from "@/components/MatterCard";
import { requireSession } from "@/lib/auth/session";
import { buildBoard } from "@/lib/board/board";
import {
  daysInStage,
  matterIsStale,
  type MatterWaitingOn,
} from "@/lib/board/stage-rules";
import {
  buildCalendar,
  countsFor,
  courtTimeOfDay,
  type CalendarRow,
  type DeadlineSourceRow,
  type HearingSourceRow,
  type TaskSourceRow,
} from "@/lib/calendar/rows";
import { getScopedClient } from "@/lib/db/scoped-client";
import { deadlineKindShortLabel } from "@/lib/deadlines/kinds";
import { listOpenDeadlines, type OpenDeadline } from "@/lib/deadlines/read";
import { courtToday, formatDocketDateWithYear, isCivilDate } from "@/lib/format/date";
import { listMatters, type Matter } from "@/lib/matters/read";
import { listMatterStages } from "@/lib/matters/stages";
import {
  isCollectionsStageCode,
  isLitigationStageCode,
  practiceLabel,
  practicesInOrder,
  resolvePractice,
  type PracticeId,
} from "@/lib/practice/resolve";
import { countOpenDemands, listTasks, type TaskRow } from "@/lib/tasks";

/**
 * `/` — Today.
 *
 * A Server Component, rendering in the order the plan fixes: the ranked
 * deadline list is the first content element in the DOM with nothing above it
 * but the title bar, the month grid sits beside it, `UP NEXT` runs full-width
 * beneath both, the practice board follows, and the attention strip closes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE WIDGET FAILING MUST NOT TAKE THE SCREEN DOWN, AND MUST NEVER READ AS ZERO
 *
 * Every read below is dispatched through `Promise.allSettled`, and each result
 * is unwrapped into `T | undefined` — never into `[]` or `0`. The distinction is
 * the whole reason this page is written this way: "we could not count" and
 * "there are none" look identical once a failed fetch has been coalesced to a
 * zero, and on this dashboard "0 open · 0 overdue" is the exact sentence a
 * missed pretrial conference hides behind. So a failed source renders an em
 * dash, its widget says out loud that it is incomplete, and everything that did
 * load renders normally around it.
 *
 * COUNTS COME FROM `countsFor` AND NOWHERE ELSE. The "N open · M overdue" strip
 * is computed from the merged calendar rows via `countsFor`, which counts
 * `deadline` and `hearing` rows only. Tasks and external (Outlook) events are
 * structurally excluded: an external event is context on somebody else's
 * calendar, not an obligation this firm owes a court, and counting one would
 * let a lunch appointment carry the same weight as a hearing. The deadline list
 * is fed from exactly the rows `countsFor` counted, so the number in the header
 * and the rows on the screen can never disagree.
 *
 * NO `org_id` FILTER ON THE ONE QUERY THIS FILE MAKES. RLS scopes every read on
 * the caller's `active_org_id` claim. A redundant filter would turn a policy
 * regression into a silently empty screen instead of a loud failure.
 */

// Reads auth cookies, so this page can never be statically prerendered.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// ── Practice selection ───────────────────────────────────────────────────────

/**
 * Selection lives in the URL (`?practice=…`), not in client state, so the tab
 * survives a reload, is linkable, and needs no state machine on a page that is
 * otherwise entirely server-rendered.
 *
 * This is a Server Action rather than an `hrefFor` prop because `PracticeTabs`
 * is a client component and a plain function cannot cross that boundary; a
 * Server Action can. See the note in the return value of this build about the
 * small client wrapper that would restore real `<a>` semantics.
 */
async function selectPractice(practice: PracticeId): Promise<void> {
  "use server";
  redirect(`/?practice=${practice}`);
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveSelectedPractice(raw: string | undefined): PracticeId {
  const practices = practicesInOrder();
  const match = practices.find((p) => p.id === raw);
  // Defaults to the first practice in the registry — the registry's order, not
  // a hardcoded favourite. This firm runs two unrelated practices out of one
  // tenant and neither is the "real" one.
  return (match ?? practices[0]).id;
}

// ── Result unwrapping ────────────────────────────────────────────────────────

/** `undefined` on rejection — never a zero, never an empty array. */
function value<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

// ── The one read this file owns ──────────────────────────────────────────────

type LitigationFacts = {
  matter_id: string;
  county: string | null;
  court_division: string | null;
  next_hearing_at: string | null;
  next_hearing_purpose: string | null;
};

/**
 * Litigation facts for every matter that has them: the venue a docket row is
 * heard in, and the next hearing instant.
 *
 * Read unfiltered rather than `next_hearing_at IS NOT NULL`, because the same
 * rows supply the court/county each deadline row is labelled with. One read,
 * both uses, and no chance of the two drifting.
 */
async function readLitigationFacts(): Promise<LitigationFacts[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_litigation_detail")
    .select("matter_id, county, court_division, next_hearing_at, next_hearing_purpose");
  if (error) throw error;
  return data ?? [];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();

  if (session.status === "signed-out") {
    return (
      <Panel eyebrow="Lectual">
        <h1 className="text-2xl font-semibold tracking-tight">Signed out</h1>
        <p className="text-sm leading-relaxed text-[var(--ink-2)]">
          Sign in with a magic link to see your deadlines and matters.
        </p>
        <Link
          href="/sign-in/"
          className="justify-self-start rounded-[var(--r-sm)] bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-[var(--accent-ink)]"
        >
          Sign in
        </Link>
      </Panel>
    );
  }

  if (session.status === "no-access") {
    return (
      <Panel eyebrow="Lectual">
        <h1 className="text-2xl font-semibold tracking-tight">No firm access yet</h1>
        <p className="text-sm leading-relaxed text-[var(--ink-2)]">
          {session.user.email ?? "This account"} is signed in, but isn&apos;t a member of a
          Lectual firm workspace. Ask your firm admin to add this email, or sign in with an
          account that already belongs to one.
        </p>
        {/* A just-invited member lands here even though the membership row
            exists: active_org_id is minted at token-issue time, so a
            pre-invite token genuinely shows no firm. Signing in again re-mints
            it. */}
        <p className="text-xs text-[var(--muted)]">
          Just been invited? Your sign-in token predates the invite — request a fresh link to
          pick up your firm.
        </p>
        <Link
          href="/sign-in/"
          className="justify-self-start rounded-[var(--r-sm)] border border-[var(--border-strong)] px-4 py-2.5 text-sm font-semibold"
        >
          Request a fresh link
        </Link>
      </Panel>
    );
  }

  const params = await searchParams;
  const activePractice = resolveSelectedPractice(firstParam(params.practice));
  const dayParam = firstParam(params.day);
  const selectedDate = isCivilDate(dayParam) ? dayParam : null;

  // The court's today, read once and threaded everywhere. Nothing downstream
  // reads the clock for itself: a component that asked `new Date()` would band
  // against the day UTC is having, which after 8pm in Florida is tomorrow.
  const today = courtToday();

  const [deadlinesResult, mattersResult, stagesResult, tasksResult, litigationResult, demandsResult] =
    await Promise.allSettled([
      listOpenDeadlines(),
      listMatters(),
      listMatterStages(),
      listTasks({ status: "open" }),
      readLitigationFacts(),
      countOpenDemands(),
    ]);

  const deadlines = value(deadlinesResult);
  const matters = value(mattersResult);
  const stages = value(stagesResult);
  const tasks = value(tasksResult);
  const litigation = value(litigationResult);
  const demandCount = value(demandsResult);

  const matterNumberById = new Map<string, string>(
    (matters ?? []).map((m) => [m.id, m.matter_number]),
  );
  const factsByMatter = new Map<string, LitigationFacts>(
    (litigation ?? []).map((row) => [row.matter_id, row]),
  );

  // ── The calendar engine, once, for the grid and for UP NEXT ────────────────
  //
  // The month grid and the 14-day list are the same rows at two densities. One
  // merge means they cannot drift, and the day one of them silently dropped a
  // row would be the day nobody noticed.
  const { rows: calendarRows, externalUnavailable } = buildCalendar({
    deadlines: (deadlines ?? []).map(toDeadlineSource),
    hearings: (litigation ?? []).map((row) => toHearingSource(row, matterNumberById)),
    tasks: (tasks ?? []).map((task) => toTaskSource(task, matterNumberById)),
    today,
    // Outlook is M6. The seam is `external` on this call, and its failure mode
    // is already handled below by `externalUnavailable` rather than by silence.
  });

  // Counted rows only — `deadline` and `hearing`. This is the single source of
  // both the header numbers and the rows the deadline list renders.
  const counts = deadlines === undefined ? undefined : countsFor(calendarRows);
  const deadlineItems = toDeadlineListItems(calendarRows, deadlines ?? [], factsByMatter);

  // ── The board ─────────────────────────────────────────────────────────────
  const boardEntries = (matters ?? []).map((m) =>
    toBoardEntry(m, deadlines, factsByMatter),
  );
  const practiceCounts = countMattersByPractice(matters);
  const practiceEntries = boardEntries.filter(
    (entry) => entry.practice === activePractice,
  );
  const board = buildBoard(stages ?? [], practiceEntries);
  const columns = board.open.filter(
    (column) =>
      column.matters.length > 0 || stageBelongsToPractice(column.stage.code, activePractice),
  );

  // ── The attention strip ───────────────────────────────────────────────────
  const unconfirmedDates = deadlines?.filter((d) => !d.attorney_confirmed).length;
  const stalledCases = matters?.filter((m) =>
    matterIsStale({
      stage_entered_at: m.stage_entered_at,
      waiting_on: m.stage?.waiting_on ?? null,
    }),
  ).length;

  const failures = [
    deadlines === undefined ? "deadlines" : null,
    matters === undefined ? "matters" : null,
    stages === undefined ? "stages" : null,
    tasks === undefined ? "tasks" : null,
    litigation === undefined ? "hearings" : null,
  ].filter((s): s is string => s !== null);

  return (
    <Shell
      wide
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.actingAsStaff ? `${session.role} · Lectual staff` : session.role}
    >
      <div className="grid gap-4">
        {/* Title bar. The only thing permitted above the deadline list. */}
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Today</h1>
          <p className="font-mono text-xs text-muted">{formatDocketDateWithYear(today)}</p>
          <p className="ml-auto font-mono text-sm tabular-nums text-ink-2">
            {counts ? (
              <>
                {counts.total} open
                {counts.overdue > 0 ? (
                  <>
                    {" · "}
                    <span className="font-bold text-overdue">{counts.overdue} overdue</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {/* Not "0 open". We could not count, and saying so is the
                    entire point of this page. */}
                <span aria-hidden="true">— open · — overdue</span>
                <span className="sr-only">Deadline counts unavailable.</span>
              </>
            )}
          </p>
        </header>

        {failures.length > 0 ? (
          <p
            role="status"
            className="rounded-md border border-soon-border bg-soon-bg px-3 py-2 text-xs text-soon"
          >
            This screen is incomplete: {failures.join(", ")} could not be loaded. What is
            shown below is not the whole docket — reload, and treat any count as a floor.
          </p>
        ) : null}

        {/* 1. DEADLINE LIST and MONTH CALENDAR, side by side on desktop and
            stacked on a phone. The list is first in the DOM either way. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          {deadlines === undefined ? (
            <Card eyebrow="Deadlines">
              <EmptyState
                tone="warning"
                title="Deadlines could not be loaded"
                description="This is a failure, not an empty docket. Nothing here says anything about what is due — reload the page, and check the docket directly before relying on this screen."
              />
            </Card>
          ) : (
            <DeadlineList deadlines={deadlineItems} today={today} />
          )}

          <Card
            eyebrow="Calendar"
            footer={<CalendarLegend showUrgency />}
            className="lg:sticky lg:top-16"
          >
            {externalUnavailable ? (
              <p role="status" className="mb-2 text-xs text-soon">
                Outlook not connected — reconnect. Your Lectual deadlines below are complete.
              </p>
            ) : null}
            <CalendarGrid today={today} rows={calendarRows} selectedDate={selectedDate} />
          </Card>
        </div>

        {/* 2. UP NEXT — full width, beneath both. */}
        <div className="grid gap-2">
          <UpNext rows={calendarRows} today={today} selectedDate={selectedDate} />
          {selectedDate ? (
            <Link
              href={`/?practice=${activePractice}`}
              className="justify-self-start rounded-[var(--r-sm)] border border-border-strong px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-3"
            >
              Show all 14 days
            </Link>
          ) : null}
        </div>

        {/* 3. Practice tabs + the stage board for the selected practice. */}
        <section aria-label="Practice board" className="grid gap-3">
          <PracticeTabs
            active={activePractice}
            counts={practiceCounts}
            onSelect={selectPractice}
          />

          <div
            id={`practice-panel-${activePractice}`}
            role="tabpanel"
            aria-label={`${practiceLabel(activePractice)} board`}
          >
            {matters === undefined || stages === undefined ? (
              <EmptyState
                tone="warning"
                title="The board could not be loaded"
                description="Matters or the stage catalog failed to load. No conclusion should be drawn from an empty board — reload the page."
              />
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {/* The unplaced lane is pinned first and always rendered, even
                    at zero. 22 of this firm's 34 live litigation matters carry
                    `stage_id IS NULL`; a board keyed on stage_id alone would
                    silently delete 65% of the caseload from the screen. */}
                <UnplacedLane
                  matters={board.unstaged}
                  today={today}
                  className="w-[17rem] shrink-0"
                />
                {columns.map((column) => (
                  <StageLane
                    key={column.stage.id}
                    stage={column.stage}
                    matters={column.matters}
                    stale={column.stale}
                    today={today}
                    className="w-[17rem] shrink-0"
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 4. The attention strip. */}
        <AttentionStrip
          demandsWaiting={{ count: demandCount, href: "/demands/" }}
          unconfirmedDates={{ count: unconfirmedDates, href: "/calendar/" }}
          stalledCases={{ count: stalledCases, href: `/pipeline/${activePractice}/` }}
          // Consultations that did not convert live on leads, which this app
          // does not read yet (M4). Deliberately left uncounted: an em dash is
          // honest, a 0 would claim every consult converted.
          consultsNotConverted={{ href: "/intake/" }}
        />
      </div>
    </Shell>
  );
}

// ── Source mapping ───────────────────────────────────────────────────────────

function toDeadlineSource(row: OpenDeadline): DeadlineSourceRow {
  return {
    id: row.id,
    matter_id: row.matter_id,
    matter_number: row.matter_number,
    kind: row.kind,
    title: row.title,
    due_date: row.due_date,
  };
}

function toHearingSource(
  row: LitigationFacts,
  matterNumbers: ReadonlyMap<string, string>,
): HearingSourceRow {
  return {
    matter_id: row.matter_id,
    matter_number: matterNumbers.get(row.matter_id) ?? null,
    next_hearing_at: row.next_hearing_at,
    next_hearing_purpose: row.next_hearing_purpose,
  };
}

function toTaskSource(
  task: TaskRow,
  matterNumbers: ReadonlyMap<string, string>,
): TaskSourceRow {
  return {
    id: task.id,
    matter_id: task.matter_id,
    matter_number: task.matter_id ? matterNumbers.get(task.matter_id) ?? null : null,
    title: task.title,
    due_at: task.due_at,
  };
}

/**
 * The rows the deadline list renders — exactly the rows `countsFor` counts.
 *
 * Deriving them from the merged calendar rather than from the raw docket read
 * is what keeps the header number and the visible rows in agreement, and it
 * carries the merge's two useful side effects for free: a `hearing` deadline
 * that absorbed a `next_hearing_at` arrives already annotated with the court
 * wall-clock time, and a hearing that exists only as `next_hearing_at` still
 * appears rather than being invisible to a docket-only read.
 */
function toDeadlineListItems(
  rows: readonly CalendarRow[],
  deadlines: readonly OpenDeadline[],
  facts: ReadonlyMap<string, LitigationFacts>,
): DeadlineListItem[] {
  const byId = new Map(deadlines.map((d) => [d.id, d]));

  return rows
    .filter((row) => row.kind === "deadline" || row.kind === "hearing")
    .map((row) => {
      const source = row.key.startsWith("deadline:")
        ? byId.get(row.key.slice("deadline:".length))
        : undefined;
      const venue = row.matterId ? facts.get(row.matterId) : undefined;

      return {
        id: row.key,
        due_date: row.date,
        status: source?.status ?? "open",
        kindLabel: source ? deadlineKindShortLabel(source.kind) : "Hearing",
        title: source?.title ?? row.title,
        matterNumber: row.matterNumber ?? null,
        court: venue?.court_division ?? null,
        county: venue?.county ?? null,
        time: row.time ?? null,
        href: row.matterId ? `/matter/${row.matterId}/` : null,
      } satisfies DeadlineListItem;
    });
}

// ── Board mapping ────────────────────────────────────────────────────────────

/**
 * A board card and a board row in one object: `MatterCardItem` for the lane to
 * render, plus the `stage_id` / `stage_entered_at` / `stage` fields
 * `buildBoard` buckets and stales on. Keeping them together means the card the
 * lane draws is provably the matter the board placed.
 */
type BoardEntry = MatterCardItem & {
  stage_id: string | null;
  stage_entered_at: string | null;
  stage: { waiting_on?: MatterWaitingOn | null } | null;
  practice: PracticeId;
};

function toBoardEntry(
  matter: Matter,
  deadlines: readonly OpenDeadline[] | undefined,
  facts: ReadonlyMap<string, LitigationFacts>,
): BoardEntry {
  // `listOpenDeadlines` returns soonest-first, so the first hit is the next
  // thing due on this matter. `undefined` when the docket read failed — the
  // card then shows no deadline line rather than claiming the docket is clear.
  const next = deadlines?.find((d) => d.matter_id === matter.id);
  const hearingTime = facts.get(matter.id)?.next_hearing_at ?? null;

  return {
    id: matter.id,
    matterNumber: matter.matter_number,
    title: matter.title,
    nextDeadline: next
      ? {
          due_date: next.due_date,
          kindLabel: deadlineKindShortLabel(next.kind),
          // Only a hearing carries a wall-clock; every other docket row is a
          // civil date with no time of day, and inventing one would be a lie.
          time: next.kind === "hearing" && hearingTime ? courtTimeOfDay(hearingTime) : null,
        }
      : null,
    daysInStage: daysInStage(matter.stage_entered_at),
    stale: matterIsStale({
      stage_entered_at: matter.stage_entered_at,
      waiting_on: matter.stage?.waiting_on ?? null,
    }),
    href: `/matter/${matter.id}/`,
    stage_id: matter.stage_id,
    stage_entered_at: matter.stage_entered_at,
    stage: matter.stage,
    practice: resolvePractice(matter, matter.stage),
  };
}

function countMattersByPractice(
  matters: readonly Matter[] | undefined,
): Partial<Record<PracticeId, number>> | undefined {
  if (matters === undefined) return undefined;
  // Every practice is present, including at zero: "nothing on the trademark
  // board" is a real answer, and a missing key would render as "—", which this
  // page reserves for "we could not count".
  const counts: Record<PracticeId, number> = {
    litigation: 0,
    collections: 0,
    trademark: 0,
  };
  for (const matter of matters) {
    counts[resolvePractice(matter, matter.stage)] += 1;
  }
  return counts;
}

/**
 * Whether an EMPTY stage column is worth showing on this practice's board.
 *
 * A column holding matters always renders — that check is made by the caller
 * and never by this function, so no matter can be hidden by a code that does
 * not match a ladder. This only decides whether a stage nobody is standing on
 * is drawn: an empty `HEARING_SET` on the litigation board is information (that
 * rung is clear), whereas an empty `PC30` on it is another practice's furniture.
 */
function stageBelongsToPractice(code: string, practice: PracticeId): boolean {
  if (isCollectionsStageCode(code)) return practice === "collections";
  if (isLitigationStageCode(code)) return practice === "litigation";
  // The trademark ladder is not seeded yet (M5), so anything off both known
  // ladders is treated as trademark furniture rather than hidden everywhere.
  return practice === "trademark";
}

function Panel({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="grid w-full max-w-lg gap-3 rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow)]">
        <p className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
          {eyebrow}
        </p>
        {children}
      </div>
    </main>
  );
}
