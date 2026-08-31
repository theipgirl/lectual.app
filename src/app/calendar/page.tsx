import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/Badge";
import { CalendarGrid } from "@/components/CalendarGrid";
import { CalendarLegend } from "@/components/CalendarLegend";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Shell } from "@/components/Shell";
import { urgencyTokens } from "@/components/UrgencyBadge";
import { requireSession } from "@/lib/auth/session";
import {
  addDays,
  monthLabel,
  monthOf,
  nextMonth,
  previousMonth,
} from "@/lib/calendar/month";
import {
  buildCalendar,
  countsFor,
  type CalendarRow,
  type CalendarRowKind,
  type DeadlineSourceRow,
  type HearingSourceRow,
  type TaskSourceRow,
} from "@/lib/calendar/rows";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listOpenDeadlines } from "@/lib/deadlines/read";
import { urgencyLabel } from "@/lib/deadlines/urgency";
import {
  courtToday,
  formatDocketDate,
  formatDocketDateWithYear,
  docketWeekday,
  isCivilDate,
} from "@/lib/format/date";
import { listMatters } from "@/lib/matters/read";
import {
  practiceLabel,
  practicesInOrder,
  resolvePractice,
  type PracticeId,
} from "@/lib/practice/resolve";
import { listTasks } from "@/lib/tasks";

/**
 * `/calendar` — the full calendar, off the same engine as the home grid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ENGINE, TWO SURFACES
 *
 * Nothing on this page reads the database differently from the home screen. The
 * four sources are merged by `buildCalendar` in `@/lib/calendar/rows`, the month
 * shape comes from `@/lib/calendar/month`, and the grid itself is the very
 * `CalendarGrid` the dashboard renders. This page adds density — a whole-month
 * agenda, filters and a printable sheet — and adds nothing else. If the two
 * screens ever disagree about what is due, it will be a bug in one shared
 * module rather than a divergence nobody noticed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERVER COMPONENT, STATE IN THE URL
 *
 * View, anchor date and both filters live in search params, so every state of
 * this page is a link: bookmarkable, shareable, back-button-able, and — the
 * reason that matters here — printable. "Print me the week of the 14th with
 * hearings only" is a URL, and the paper it produces says on its face which URL
 * it was.
 *
 *   ?view=month|agenda   grid or linear list          (default: month)
 *   ?range=month|week    agenda span                  (default: month)
 *   ?on=YYYY-MM-DD       anchor date                  (default: today, court time)
 *   ?sources=…           any of deadlines,hearings,tasks (default: all)
 *   ?practice=…          a PRACTICES id, or all       (default: all)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PAGE REFUSES TO DO
 *
 * · IT DOES NOT BOUND THE NEAR END OF ANY READ. Two deadlines on this docket are
 *   intentionally-overdue lapsed appeal windows. A calendar that only fetched
 *   the month in view would drop them the moment she paged forward, so every
 *   open deadline, every hearing and every open dated task is read once and the
 *   window is applied at render. On a docket this size that is cheaper than the
 *   round trips a windowed read would need, and it makes an empty cell mean
 *   "nothing is due" rather than "nothing was fetched".
 *
 * · IT NEVER LETS A FILTER HIDE AN OVERDUE ROW SILENTLY. Filters and the visible
 *   window can both exclude a blown date; when they do, the header says so in
 *   words, with a link that clears the filter. The one thing this dashboard
 *   exists to prevent is a screen that looks like "nothing is due" when
 *   something is.
 *
 * · NO `org_id` FILTER ANYWHERE. RLS scopes every read through the caller's JWT.
 *   See `@/lib/db/scoped-client`.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar",
};

// ── URL state ────────────────────────────────────────────────────────────────

type View = "month" | "agenda";
type Range = "month" | "week";

/** The three docket sources a user can switch off, and the row kinds they map to. */
const SOURCE_FILTERS = [
  { id: "deadlines", label: "Deadlines", kind: "deadline" as CalendarRowKind },
  { id: "hearings", label: "Hearings", kind: "hearing" as CalendarRowKind },
  { id: "tasks", label: "Tasks", kind: "task" as CalendarRowKind },
] as const;

type SourceId = (typeof SOURCE_FILTERS)[number]["id"];

const ALL_SOURCES: readonly SourceId[] = SOURCE_FILTERS.map((s) => s.id);

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every filter parses toward showing MORE. An unrecognised `view`, `range`,
 * `practice` or source name falls back to the widest reading rather than to an
 * empty screen: a typo in a URL must not be able to hide a court date.
 */
function parseView(raw: string | undefined): View {
  return raw === "agenda" ? "agenda" : "month";
}

function parseRange(raw: string | undefined): Range {
  return raw === "week" ? "week" : "month";
}

function parseAnchor(raw: string | undefined, today: string): string {
  return isCivilDate(raw) ? raw : today;
}

function parsePractice(raw: string | undefined): PracticeId | "all" {
  const match = practicesInOrder().find((p) => p.id === raw);
  return match ? match.id : "all";
}

function parseSources(raw: string | undefined): SourceId[] {
  if (raw === undefined) return [...ALL_SOURCES];
  // An explicitly empty list is honoured — she asked for no docket rows — but
  // the header still reports what is being withheld.
  const requested = new Set(raw.split(",").map((s) => s.trim()));
  return ALL_SOURCES.filter((id) => requested.has(id));
}

type ViewState = {
  view: View;
  range: Range;
  anchor: string;
  sources: SourceId[];
  practice: PracticeId | "all";
};

/**
 * The view state plus today's civil date. Today is carried alongside so link
 * building can leave the anchor out of the URL when it is just "today" — the
 * canonical `/calendar/` link stays clean, and a bookmark to it follows the
 * clock instead of freezing on the day it was made.
 */
type ViewStateWithToday = ViewState & { today0: string };

/** Builds a link to this page with some of the view state changed. */
function hrefFor(state: ViewStateWithToday, overrides: Partial<ViewState>): string {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (next.view !== "month") params.set("view", next.view);
  if (next.range !== "month") params.set("range", next.range);
  if (next.anchor !== state.today0) params.set("on", next.anchor);
  if (next.sources.length !== ALL_SOURCES.length) params.set("sources", next.sources.join(","));
  if (next.practice !== "all") params.set("practice", next.practice);
  const query = params.toString();
  return query ? `/calendar/?${query}` : "/calendar/";
}

// ── Window arithmetic ────────────────────────────────────────────────────────

/** UTC weekday of a civil date. Civil dates are timezone-free, so UTC is exact. */
function weekdayIndex(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Sunday-anchored week containing `date`, as an inclusive civil range. */
function weekWindow(date: string): { start: string; end: string; label: string } {
  const start = addDays(date, -weekdayIndex(date));
  const end = addDays(start, 6);
  return {
    start,
    end,
    label: `${formatDocketDate(start)} – ${formatDocketDateWithYear(end)}`,
  };
}

/** The calendar month containing `date`, as an inclusive civil range. */
function monthWindow(date: string): { start: string; end: string; label: string } {
  const { year, month } = monthOf(date);
  const start = `${date.slice(0, 7)}-01`;
  const nextFirst = nextMonth(year, month);
  const end = addDays(
    `${String(nextFirst.year).padStart(4, "0")}-${String(nextFirst.month).padStart(2, "0")}-01`,
    -1,
  );
  return { start, end, label: monthLabel(year, month) };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();

  if (session.status !== "ok") {
    // Absence of access must look like absence of access — never like an empty
    // calendar. `requireSession` is a three-way union precisely so this branch
    // cannot be forgotten.
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="grid w-full max-w-lg gap-3 rounded-lg border border-border bg-surface p-7 shadow-[var(--shadow)]">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted">Calendar</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.status === "signed-out" ? "Signed out" : "No firm access yet"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-2">
            {session.status === "signed-out"
              ? "Sign in with a magic link to see the docket calendar."
              : "This account is signed in but is not a member of a Lectual firm workspace, so there is no docket to show. This is not an empty calendar."}
          </p>
          <Link
            href="/sign-in/"
            className="justify-self-start rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink"
          >
            {session.status === "signed-out" ? "Sign in" : "Request a fresh link"}
          </Link>
        </div>
      </main>
    );
  }

  const today = courtToday();
  const params = await searchParams;

  const state: ViewStateWithToday = {
    view: parseView(first(params.view)),
    range: parseRange(first(params.range)),
    anchor: parseAnchor(first(params.on), today),
    sources: parseSources(first(params.sources)),
    practice: parsePractice(first(params.practice)),
    today0: today,
  };

  const link = (overrides: Partial<ViewState>) => hrefFor(state, overrides);

  // ── Read ───────────────────────────────────────────────────────────────────
  // Four reads, none of them bounded at the near end, none of them carrying an
  // org_id filter. `crm_litigation_detail` has no read module of its own yet, so
  // it is queried here directly through the same scoped client every other read
  // uses; the matter number is joined in memory from the matter list rather than
  // through a PostgREST embed, whose shape over a composite FK is not stable.
  const supabase = await getScopedClient();
  const [matters, deadlines, tasks, hearingDetails] = await Promise.all([
    listMatters(),
    listOpenDeadlines(),
    listTasks({ status: "open" }),
    (async () => {
      const { data, error } = await supabase
        .from("crm_litigation_detail")
        .select("matter_id, next_hearing_at, next_hearing_purpose")
        .not("next_hearing_at", "is", null);
      if (error) throw error;
      return data ?? [];
    })(),
  ]);

  const matterNumberById = new Map(matters.map((m) => [m.id, m.matter_number]));

  /**
   * Which practice each matter belongs to. Resolved from the matter's type and
   * its stage — an unplaced LIT matter is litigation, which is the branch that
   * keeps 22 of this firm's 34 live litigation matters on the screen.
   */
  const practiceByMatter = new Map<string, PracticeId>(
    matters.map((m) => [m.id, resolvePractice(m, m.stage)]),
  );

  /**
   * EVERY source row is merged, whatever practice it belongs to. The practice
   * filter is applied to the merged ROWS below, never to the sources here, and
   * that ordering is load-bearing: `overdueHidden` can only report a blown date
   * that a filter is hiding if the row reached the merge in the first place.
   * Filtering the sources would delete the other practices' overdue rows before
   * anything could notice they were missing — which is the silent-hiding this
   * page exists to refuse.
   */
  const deadlineSources: DeadlineSourceRow[] = deadlines.map((d) => ({
    id: d.id,
    matter_id: d.matter_id,
    matter_number: d.matter_number,
    kind: d.kind,
    title: d.title,
    due_date: d.due_date,
  }));

  const hearingSources: HearingSourceRow[] = hearingDetails.map((h) => ({
    matter_id: h.matter_id,
    matter_number: matterNumberById.get(h.matter_id) ?? null,
    next_hearing_at: h.next_hearing_at,
    next_hearing_purpose: h.next_hearing_purpose,
  }));

  const taskSources: TaskSourceRow[] = tasks
    .filter((t) => t.due_at !== null)
    .map((t) => ({
      id: t.id,
      matter_id: t.matter_id,
      matter_number: t.matter_id ? (matterNumberById.get(t.matter_id) ?? null) : null,
      title: t.title,
      due_at: t.due_at,
    }));

  // ── Merge ──────────────────────────────────────────────────────────────────
  // The dedupe of a `hearing` deadline against a `next_hearing_at` happens
  // inside the engine, before any filtering, so switching a source off can never
  // resurrect a row the other source had absorbed.
  const { rows: allRows, externalUnavailable } = buildCalendar({
    deadlines: deadlineSources,
    hearings: hearingSources,
    tasks: taskSources,
    today,
  });

  const enabled = new Set<CalendarRowKind>(
    SOURCE_FILTERS.filter((s) => state.sources.includes(s.id)).map((s) => s.kind),
  );

  /**
   * The practice filter applies to rows that HAVE a matter. A task with no
   * matter_id cannot be attributed to a practice, so it is withheld while a
   * practice is selected rather than being guessed into one.
   */
  const inPractice = (row: CalendarRow): boolean =>
    state.practice === "all" ||
    (row.matterId != null && practiceByMatter.get(row.matterId) === state.practice);

  // External events are never filtered here: they are an additive overlay, are
  // never counted as obligations, and (until M6 wires Outlook) there are none.
  const visible = (row: CalendarRow): boolean =>
    row.kind === "external" || (enabled.has(row.kind) && inPractice(row));

  const rows = allRows.filter(visible);

  const span =
    state.view === "agenda" && state.range === "week"
      ? weekWindow(state.anchor)
      : monthWindow(state.anchor);

  const windowRows = rows.filter((r) => r.date >= span.start && r.date <= span.end);
  const counts = countsFor(windowRows);

  // Overdue rows anywhere on the docket that this screen is not currently
  // showing — because of the window, or because either filter excluded them.
  // `allRows` is the unfiltered merge, so a practice filter cannot make an
  // overdue date disappear from this check along with the screen.
  const overdueEverywhere = allRows.filter((r) => r.urgency === "overdue");
  const overdueHidden = overdueEverywhere.filter(
    (r) => !(visible(r) && r.date >= span.start && r.date <= span.end),
  ).length;

  const anchorMonth = monthOf(state.anchor);
  const previous =
    state.view === "agenda" && state.range === "week"
      ? addDays(state.anchor, -7)
      : firstOfMonth(previousMonth(anchorMonth.year, anchorMonth.month));
  const next =
    state.view === "agenda" && state.range === "week"
      ? addDays(state.anchor, 7)
      : firstOfMonth(nextMonth(anchorMonth.year, anchorMonth.month));

  const filtersActive =
    state.practice !== "all" || state.sources.length !== ALL_SOURCES.length;

  return (
    <Shell
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.role}
    >
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="grid gap-4">
        {/* On paper the browser prints no URL context worth reading, so the
            sheet states for itself which firm, which span and which filters it
            was made from. A printed agenda with no scope on it is a hazard. */}
        <div className="hidden print:block">
          <h1 className="text-lg font-semibold">
            {session.orgName} — docket calendar
          </h1>
          <p className="text-xs text-ink-2">
            {span.label} · {state.view === "month" ? "Month grid" : "Agenda"} ·{" "}
            {state.practice === "all" ? "All practices" : practiceLabel(state.practice)} ·{" "}
            {state.sources.length === ALL_SOURCES.length
              ? "All sources"
              : state.sources.length === 0
                ? "No docket sources"
                : SOURCE_FILTERS.filter((s) => state.sources.includes(s.id))
                    .map((s) => s.label)
                    .join(", ")}{" "}
            · printed {formatDocketDateWithYear(today)}
          </p>
        </div>

        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 print:hidden">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Calendar
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{span.label}</h1>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {counts.total === 0
                ? "No deadlines or hearings in this span."
                : `${counts.total} ${counts.total === 1 ? "obligation" : "obligations"} · ${counts.overdue} overdue · ${counts.soon} due within 7 days`}
              {counts.uncounted > 0 ? (
                <span className="text-muted">
                  {" "}
                  · {counts.uncounted} task{counts.uncounted === 1 ? "" : "s"} and calendar{" "}
                  {counts.uncounted === 1 ? "event" : "events"}, not counted as obligations
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle state={state} link={link} />
            <span className="flex items-center gap-1">
              <NavLink href={link({ anchor: previous })} label="Previous">
                ‹
              </NavLink>
              <NavLink href={link({ anchor: today })} label="Jump to today" wide>
                Today
              </NavLink>
              <NavLink href={link({ anchor: next })} label="Next">
                ›
              </NavLink>
            </span>
          </div>
        </header>

        <FilterBar state={state} link={link} />

        {overdueHidden > 0 ? (
          // A blown date that this screen is not showing gets said out loud.
          // Colour, a filter chip and an empty grid all fail silently; a
          // sentence does not.
          <p className="rounded-md border border-overdue-border bg-overdue-bg px-3 py-2 text-[13px] text-overdue print:hidden">
            <strong className="font-semibold">
              {overdueHidden} overdue {overdueHidden === 1 ? "date is" : "dates are"} not shown
            </strong>{" "}
            here — {filtersActive ? "a filter or " : ""}this span excludes{" "}
            {overdueHidden === 1 ? "it" : "them"}.{" "}
            <Link
              href={hrefFor(state, {
                anchor: overdueEverywhere[0]?.date ?? today,
                practice: "all",
                sources: [...ALL_SOURCES],
              })}
              className="font-semibold underline underline-offset-2"
            >
              Show everything overdue
            </Link>
          </p>
        ) : null}

        {externalUnavailable ? (
          <p className="rounded-md border border-border-strong bg-surface-3 px-3 py-2 text-[13px] text-ink-2 print:hidden">
            Outlook is not connected right now, so its events are missing from this
            calendar. Everything below is Lectual&apos;s own docket and is complete.
          </p>
        ) : null}

        {state.view === "month" ? (
          <Card
            eyebrow="Month"
            title={span.label}
            meta={<CalendarLegend showUrgency />}
            id="calendar-month"
          >
            {/* Keyed on the anchor month so a change to `?on=` remounts the grid
                on the right month. The grid's own ‹ › buttons page it locally
                without a round trip; the agenda view is the URL-driven one. */}
            <CalendarGrid
              key={`${anchorMonth.year}-${anchorMonth.month}`}
              today={today}
              month={anchorMonth}
              rows={rows}
            />
            <p className="mt-3 text-xs text-muted">
              Every day in the month is drawn, including days with nothing on them. Use the
              agenda view to read the same rows as a list, or to print them.
            </p>
          </Card>
        ) : (
          <Agenda rows={windowRows} span={span} state={state} link={link} />
        )}
      </div>
    </Shell>
  );
}

function firstOfMonth({ year, month }: { year: number; month: number }): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

// ── Controls ─────────────────────────────────────────────────────────────────

function NavLink({
  href,
  label,
  wide = false,
  children,
}: {
  href: string;
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={[
        "rounded-sm border border-border-strong bg-surface text-[13px] font-semibold text-ink-2",
        "outline-offset-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent",
        wide ? "px-2.5 py-1" : "px-2 py-1 leading-5",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

/** Pill styling shared by every filter and toggle on this page. */
function pillClass(selected: boolean): string {
  return [
    "rounded-sm border px-2.5 py-1 text-[12px] font-semibold outline-offset-2",
    "focus-visible:outline-2 focus-visible:outline-accent",
    selected
      ? "border-accent bg-accent text-accent-ink"
      : "border-border-strong bg-surface text-ink-2 hover:bg-surface-3",
  ].join(" ");
}

function ViewToggle({
  state,
  link,
}: {
  state: ViewStateWithToday;
  link: (overrides: Partial<ViewState>) => string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Calendar view">
      <Link
        href={link({ view: "month" })}
        aria-current={state.view === "month" ? "page" : undefined}
        className={pillClass(state.view === "month")}
      >
        Month
      </Link>
      <Link
        href={link({ view: "agenda", range: state.range })}
        aria-current={state.view === "agenda" ? "page" : undefined}
        className={pillClass(state.view === "agenda")}
      >
        Agenda
      </Link>
      {state.view === "agenda" ? (
        <>
          <Link
            href={link({ range: "week" })}
            aria-current={state.range === "week" ? "page" : undefined}
            className={pillClass(state.range === "week")}
          >
            Week
          </Link>
          <Link
            href={link({ range: "month" })}
            aria-current={state.range === "month" ? "page" : undefined}
            className={pillClass(state.range === "month")}
          >
            Month
          </Link>
        </>
      ) : null}
    </div>
  );
}

/**
 * Source and practice filters.
 *
 * Both are links, not form controls, so the page needs no client JavaScript and
 * every filtered state is a URL she can bookmark or print. Each source pill
 * toggles its own membership; the practice pills are single-select and always
 * offer "All practices" first — no practice is the default one.
 */
function FilterBar({
  state,
  link,
}: {
  state: ViewStateWithToday;
  link: (overrides: Partial<ViewState>) => string;
}) {
  const allOn = state.sources.length === ALL_SOURCES.length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Show
        </span>
        {SOURCE_FILTERS.map((source) => {
          const on = state.sources.includes(source.id);
          const nextSources = on
            ? state.sources.filter((s) => s !== source.id)
            : ALL_SOURCES.filter((s) => s === source.id || state.sources.includes(s));
          return (
            <Link
              key={source.id}
              href={link({ sources: nextSources })}
              aria-pressed={on}
              className={pillClass(on)}
            >
              {source.label}
            </Link>
          );
        })}
        {!allOn ? (
          <Link
            href={link({ sources: [...ALL_SOURCES] })}
            className="text-[12px] font-semibold text-accent underline underline-offset-2"
          >
            Show all sources
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Practice
        </span>
        <Link
          href={link({ practice: "all" })}
          aria-current={state.practice === "all" ? "true" : undefined}
          className={pillClass(state.practice === "all")}
        >
          All
        </Link>
        {practicesInOrder().map((practice) => (
          <Link
            key={practice.id}
            href={link({ practice: practice.id })}
            aria-current={state.practice === practice.id ? "true" : undefined}
            className={pillClass(state.practice === practice.id)}
          >
            {practice.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────────

const KIND_MARKER: Record<CalendarRowKind, string> = {
  deadline: "●",
  hearing: "●",
  task: "·",
  external: "◆",
};

const KIND_NOUN: Record<CalendarRowKind, string> = {
  deadline: "Deadline",
  hearing: "Hearing",
  task: "Task",
  external: "Calendar event",
};

/**
 * The linear reading of the same rows — one block per day that has something on
 * it, in date order.
 *
 * This is the surface that goes on paper, so it is deliberately plain: a
 * weekday, a date, and one line per obligation with the matter number on it. A
 * day with nothing on it is omitted here (unlike the grid, which draws every
 * day) because a printed page of empty Saturdays buries the days that matter.
 */
function Agenda({
  rows,
  span,
  state,
  link,
}: {
  rows: readonly CalendarRow[];
  span: { start: string; end: string; label: string };
  state: ViewStateWithToday;
  link: (overrides: Partial<ViewState>) => string;
}) {
  const days = groupByDate(rows);

  return (
    <Card
      eyebrow={state.range === "week" ? "Agenda · week" : "Agenda · month"}
      title={span.label}
      meta={<CalendarLegend showUrgency />}
      id="calendar-agenda"
    >
      {days.length === 0 ? (
        <EmptyState
          title="Nothing on the docket in this span"
          description={
            <>
              This is only {span.label}
              {state.practice === "all" ? "" : `, ${practiceLabel(state.practice)} only`}. Nothing
              has been filtered away silently — widen the span or{" "}
              <Link
                href={link({ practice: "all", sources: [...ALL_SOURCES] })}
                className="font-semibold text-accent underline underline-offset-2"
              >
                clear the filters
              </Link>{" "}
              to check.
            </>
          }
        />
      ) : (
        <ol className="grid gap-3">
          {days.map((day) => (
            <li key={day.date} className="agenda-day grid gap-1">
              <h3 className="flex items-baseline gap-2 border-b border-border pb-1">
                <span className="text-[13px] font-semibold text-ink">
                  {docketWeekday(day.date)}
                </span>
                <time dateTime={day.date} className="font-mono text-[13px] tabular-nums text-ink-2">
                  {formatDocketDateWithYear(day.date)}
                </time>
                <span className="ml-auto font-mono text-[11px] text-muted">
                  {day.rows.length} {day.rows.length === 1 ? "item" : "items"}
                </span>
              </h3>
              <ul className="grid divide-y divide-border">
                {day.rows.map((row) => (
                  <AgendaRow key={row.key} row={row} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AgendaRow({ row }: { row: CalendarRow }) {
  const ink = row.urgency ? urgencyTokens(row.urgency).ink : "var(--neutral)";

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
      <span
        aria-hidden="true"
        className="w-3 shrink-0 text-center text-sm leading-none"
        style={{ color: ink }}
      >
        {KIND_MARKER[row.kind]}
      </span>
      {/* Everything the glyph and its colour say, said in text as well. */}
      <span className="sr-only">
        {KIND_NOUN[row.kind]}
        {row.urgency ? `, ${urgencyLabel(row.urgency)}` : ""}.{" "}
      </span>

      <span className="min-w-0 flex-1 text-[13px] text-ink">
        {row.title}
        {row.time ? (
          <span className="ml-2 font-mono text-xs font-semibold text-ink-2">{row.time}</span>
        ) : null}
      </span>

      {row.matterNumber ? (
        row.matterId ? (
          <Link
            href={`/matter/${row.matterId}/`}
            className="rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Badge mono>{row.matterNumber}</Badge>
          </Link>
        ) : (
          <Badge mono>{row.matterNumber}</Badge>
        )
      ) : null}
    </li>
  );
}

/** Rows grouped into days, in date order. Days with nothing on them are absent. */
function groupByDate(rows: readonly CalendarRow[]): { date: string; rows: CalendarRow[] }[] {
  const byDate = new Map<string, CalendarRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, dayRows]) => ({ date, rows: dayRows }));
}

// ── Print ────────────────────────────────────────────────────────────────────

/**
 * The print sheet.
 *
 * Printing the week is a real workflow here: paper goes in a bag and comes out
 * in a courthouse hallway where the phone has no signal. So the printed page is
 * treated as a real output, not as a screenshot of a screen.
 *
 * · Chrome comes off — nav, filters, view toggles and every link affordance.
 *   None of them can be operated on paper.
 * · The urgency colours stay. `print-color-adjust: exact` keeps a red overdue
 *   row red on a colour printer, and because every band is also labelled in
 *   text, the sheet reads correctly out of a black-and-white one too.
 * · A day never splits across a page break. A hearing whose date is on one page
 *   and whose time is on the next is exactly the ambiguity this product exists
 *   to remove.
 * · Backgrounds go white and text goes black-on-white for toner economy, but the
 *   band inks are left alone.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm 12mm; }
  html, body {
    background: #fff !important;
    color: #000 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  a[href] { text-decoration: none !important; color: inherit !important; }
  .agenda-day { break-inside: avoid; page-break-inside: avoid; }
  .agenda-day h3 { break-after: avoid; page-break-after: avoid; }
  #calendar-month, #calendar-agenda {
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
  }
  #calendar-month [role="gridcell"], #calendar-month [role="row"] { break-inside: avoid; }
}
`;
