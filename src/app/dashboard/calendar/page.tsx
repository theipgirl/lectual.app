import Link from "next/link";
import { listTasks, listUpcomingDeadlines } from "@/lib/matters";
import { buildCalendarRows, civilDate, civilDaysBetween, groupCalendarRows, type CalendarRow } from "@/lib/matters/calendar-rows";
import { NEEDS_REVIEW_PAST_DUE_DAYS, deadlineKindLabel, splitNeedsReview } from "@/lib/matters/deadline-rules";
import type { UpcomingDeadline } from "@/lib/matters/deadlines";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { getOrgProfile } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { listCalendarEvents, type CalendarEventRow } from "@/lib/calendar/events";
import { listOutlookCalendarEvents, type OutlookCalendarEvent, type OutlookRead } from "@/lib/calendar/outlook-read";
import { formatEventWhen, joinHref } from "@/lib/calendar/outlook-format";
import { orgHasModule } from "@/lib/org/modules";
import {
  addDays,
  isCivilDate,
  monthGrid,
  parseCalendarView,
  shortTime,
  stepAnchor,
  viewRange,
  viewTitle,
  weekGrid,
  zonedParts,
  type CalendarItem,
  type CalendarView,
  type GridDay,
} from "@/lib/calendar/grid";
import type { Metadata } from "next";
import { calendarReadState } from "@/lib/calendar/read-state";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Calendar") };

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_CELL_LIMIT = 3;

function calendarHref(view: CalendarView, anchor: string): string {
  return `/dashboard/calendar/?view=${view}&d=${anchor}`;
}

function rowToItem(row: CalendarRow, unconfirmed: Set<string>): CalendarItem {
  return {
    key: row.key,
    date: row.dueDate,
    time: null,
    title: row.name,
    detail: row.source === "deadline" ? row.detail : "Task",
    href: row.href,
    kind: row.source,
    overdue: row.overdueDays > 0,
    unconfirmed: unconfirmed.has(row.key),
  };
}

function eventToItem(e: CalendarEventRow, timeZone: string): CalendarItem {
  const { date, time } = zonedParts(e.starts_at, timeZone);
  const who = [e.event_type, e.contact_name].filter(Boolean).join(" · ");
  return {
    key: `e-${e.id}`,
    date,
    time: e.all_day ? null : time,
    title: e.title?.trim() || e.event_type || "Event",
    detail: [who, e.location].filter(Boolean).join(" · ") || null,
    href: e.matter_id ? `/dashboard/matters/${e.matter_id}` : null,
    kind: "event",
    overdue: false,
    unconfirmed: false,
  };
}

/** An Outlook event: linked to its lead when there is one, marked when it is a consult. */
function outlookToItem(e: OutlookCalendarEvent, timeZone: string): CalendarItem {
  // All-day events are stored at UTC midnight; their date is the UTC date, not a shifted zoned one.
  const { date, time } = e.all_day ? { date: e.starts_at.slice(0, 10), time: "" } : zonedParts(e.starts_at, timeZone);
  return {
    key: `e-${e.id}`,
    date,
    time: e.all_day ? null : time,
    title: e.title?.trim() || (e.is_consult ? "Consult" : "Event"),
    detail: e.location || null,
    href: e.lead_id ? `/dashboard/leads/${e.lead_id}/` : null,
    kind: "event",
    overdue: false,
    unconfirmed: false,
    consult: e.is_consult,
    joinUrl: joinHref(e.join_url),
  };
}

function Chip({ item, compact }: { item: CalendarItem; compact: boolean }) {
  const cls = `lx-cal-item is-${item.kind}${item.overdue ? " is-overdue" : ""}`;
  const label = (
    <>
      {item.time && <span className="lx-cal-time">{shortTime(item.time)}</span>}
      {item.consult && <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, marginRight: 4 }}>Consult</span>}
      <span className="lx-cal-title">{item.title}</span>
      {!compact && item.detail && <span className="lx-cal-detail">{item.detail}</span>}
      {!compact && item.unconfirmed && <span className="lx-cal-detail">Unconfirmed</span>}
    </>
  );
  const title = [item.time ? shortTime(item.time) : null, item.title, item.detail, item.unconfirmed ? "unconfirmed" : null]
    .filter(Boolean)
    .join(" · ");
  const chip = item.href ? (
    <Link prefetch={false} href={item.href} className={cls} title={title}>
      {label}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {label}
    </span>
  );
  // A link inside a link is invalid, so the meeting link sits beside the chip. The month cell is too small for it.
  if (compact || !item.joinUrl) return chip;
  return (
    <>
      {chip}
      <a href={item.joinUrl} target="_blank" rel="noopener noreferrer" className="lx-cal-detail" style={{ color: "var(--ox)", fontWeight: 500 }}>
        Join
      </a>
    </>
  );
}

function MonthView({ weeks }: { weeks: GridDay[][] }) {
  return (
    <div className="lx-card lx-cal-month" role="grid" aria-label="Month">
      <div className="lx-cal-head" role="row">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="lx-cal-dow">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} className="lx-cal-week" role="row">
          {week.map((day) => (
            <div
              key={day.date}
              role="gridcell"
              className={`lx-cal-day${day.inMonth ? "" : " is-out"}${day.isToday ? " is-today" : ""}`}
              aria-label={`${formatCivilDate(day.date)}: ${day.items.length} item${day.items.length === 1 ? "" : "s"}`}
            >
              <Link prefetch={false} href={calendarHref("week", day.date)} className="lx-cal-num" aria-label={`Week of ${formatCivilDate(day.date) ?? day.date}`}>
                {day.day}
              </Link>
              {day.items.slice(0, MONTH_CELL_LIMIT).map((item) => (
                <Chip key={item.key} item={item} compact />
              ))}
              {day.items.length > MONTH_CELL_LIMIT && (
                <Link prefetch={false} href={calendarHref("week", day.date)} className="lx-cal-more">
                  +{day.items.length - MONTH_CELL_LIMIT} more
                </Link>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function WeekView({ days }: { days: GridDay[] }) {
  return (
    <div className="lx-card lx-cal-weekview" aria-label="Week">
      {days.map((day, i) => (
        <section key={day.date} className={`lx-cal-col${day.isToday ? " is-today" : ""}`} aria-label={formatCivilDate(day.date) ?? day.date}>
          <header className="lx-cal-colhead">
            <span className="lx-cal-dow">{WEEKDAYS[i]}</span>
            <span className="lx-cal-bignum">{day.day}</span>
          </header>
          <div className="lx-cal-colbody">
            {day.items.length === 0 ? (
              <span className="lx-cal-empty">—</span>
            ) : (
              day.items.map((item) => <Chip key={item.key} item={item} compact={false} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Old unconfirmed manual dates, kept out of Overdue and every count. Nothing
 * here edits or closes a date: confirming, closing and correcting stay on the
 * matter, where the attorney-only actions are.
 */
function NeedsReviewBand({ deadlines, now }: { deadlines: UpcomingDeadline[]; now: Date }) {
  const today = civilDate(now);
  return (
    <section className="lx-card lx-band" aria-labelledby="cal-needs-review">
      <header className="lx-band-head">
        <h2 id="cal-needs-review" className="lx-h2">
          Needs review
        </h2>
        <span className="lx-note">{deadlines.length}</span>
      </header>
      <ul className="lx-list" style={{ padding: "0 18px 8px" }}>
        {deadlines.map((d) => {
          const days = civilDaysBetween(d.due_date, today);
          return (
            <li key={d.id} className="lx-task">
              <span style={{ minWidth: 0 }}>
                <Link prefetch={false} href={`/dashboard/matters/${d.matter_id}`} className="lx-rowlink">
                  {d.title ?? deadlineKindLabel(d.kind)}
                </Link>
                <span className="lx-note" style={{ display: "block" }}>
                  {`${[d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket"} · due ${formatCivilDate(d.due_date)}`}
                </span>
                <span className="lx-note" style={{ display: "block" }}>
                  {`Entered by hand, never confirmed, and more than ${NEEDS_REVIEW_PAST_DUE_DAYS} days past due. Confirm, close or correct it on the matter.`}
                </span>
              </span>
              <span className="lx-pill lx-pill-mute">{`${days} days past due`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Outlook events for the next 30 days, in the same agenda as the deadlines and tasks. */
function OutlookAgendaBand({ events, timeZone }: { events: OutlookCalendarEvent[]; timeZone: string }) {
  return (
    <section className="lx-card lx-band" aria-labelledby="cal-outlook">
      <header className="lx-band-head">
        <h2 id="cal-outlook" className="lx-h2">
          Meetings and consults
        </h2>
        <span className="lx-note">{events.length}</span>
      </header>
      <ul className="lx-list" style={{ padding: "0 18px 8px" }}>
        {events.map((e) => {
          const join = joinHref(e.join_url);
          const name = e.title?.trim() || (e.is_consult ? "Consult" : "Event");
          return (
            <li key={e.id} className="lx-task">
              <span style={{ minWidth: 0 }}>
                {e.lead_id ? (
                  <Link prefetch={false} href={`/dashboard/leads/${e.lead_id}/`} className="lx-rowlink">
                    {name}
                  </Link>
                ) : (
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{name}</span>
                )}
                <span className="lx-note" style={{ display: "block" }}>
                  {[formatEventWhen(e, timeZone), e.location].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {e.is_consult && <span className="lx-pill lx-pill-ox">Consult</span>}
                {join && (
                  <a href={join} target="_blank" rel="noopener noreferrer" className="lx-btn lx-btn-sec lx-btn-sm">
                    Join
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AgendaView({
  rows,
  needsReview,
  now,
  unconfirmed,
  outlook,
  timeZone,
}: {
  rows: CalendarRow[];
  needsReview: UpcomingDeadline[];
  now: Date;
  unconfirmed: Set<string>;
  outlook: OutlookCalendarEvent[];
  timeZone: string;
}) {
  const groups = groupCalendarRows(rows, now);
  if (groups.length === 0 && needsReview.length === 0 && outlook.length === 0) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing on the docket or task list</h2>
        <p className="lx-note" style={{ margin: 0 }}>Deadlines docketed on a matter and tasks with a due date show up here.</p>
      </div>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="lx-card lx-band" aria-labelledby={`cal-${g.key}`}>
          <header className="lx-band-head">
            <h2 id={`cal-${g.key}`} className="lx-h2" style={g.key === "overdue" ? { color: "var(--wine)" } : undefined}>
              {g.label}
            </h2>
            <span className="lx-note">{g.rows.length}</span>
          </header>
          <ul className="lx-list" style={{ padding: "0 18px 8px" }}>
            {g.rows.map((r) => (
              <li key={r.key} className="lx-task">
                <span style={{ minWidth: 0 }}>
                  <Link prefetch={false} href={r.href} className="lx-rowlink">
                    {r.name}
                  </Link>
                  {unconfirmed.has(r.key) && (
                    <span className="lx-pill lx-pill-warn" style={{ marginLeft: 8 }} title="Calculated or entered, not yet confirmed by an attorney">
                      Unconfirmed
                    </span>
                  )}
                  <span className="lx-note" style={{ display: "block" }}>
                    {r.source === "deadline" ? `Docket · ${r.detail}` : "Task"}
                  </span>
                </span>
                <span className={`lx-pill ${r.overdueDays > 0 ? "lx-pill-risk" : "lx-pill-mute"}`}>
                  {r.overdueDays > 0 ? `${r.overdueDays}d overdue` : formatCivilDate(r.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {outlook.length > 0 && <OutlookAgendaBand events={outlook} timeZone={timeZone} />}
      {needsReview.length > 0 && <NeedsReviewBand deadlines={needsReview} now={now} />}
    </>
  );
}

/**
 * Calendar: a month grid, a week view and the agenda list, over the same
 * sources: open docket deadlines, open task due dates, and events in
 * crm_calendar_event, which for a firm with the mailbox module include the
 * events the daily sync reads from its connected Outlook calendars. Timed
 * events are placed in the firm's own time zone (Settings → Firm profile).
 *
 * Each source is read separately and a failed read is SAID, never drawn as an
 * empty day: a blank grid over a failed read would tell a firm nothing is due.
 * The Outlook read has its own three states (ok / database-update-needed /
 * unavailable) and a quiet one-line note; it never blanks the other sources.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const params = await searchParams;
  const view = parseCalendarView(params.view);
  const now = new Date();
  const today = civilDate(now);
  const anchor = isCivilDate(params.d) ? params.d : today;
  const range = viewRange(view, anchor);

  // The Outlook events exist only for a firm with the mailbox module; without it, no read and no note.
  const hasMailbox = await orgHasModule("mailbox");
  const outlookWindow = view === "agenda" ? { from: today, to: addDays(today, 30) } : range;

  const [deadlinesS, tasksS, profileS, eventsS, outlookS] = await Promise.allSettled([
    listUpcomingDeadlines({}),
    listTasks({ status: "open" }),
    getOrgProfile(),
    view === "agenda" ? Promise.resolve([] as CalendarEventRow[]) : listCalendarEvents(range.from, range.to),
    hasMailbox ? listOutlookCalendarEvents(outlookWindow.from, outlookWindow.to) : Promise.resolve(null),
  ]);
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const tasks = tasksS.status === "fulfilled" ? tasksS.value : null;
  const events = eventsS.status === "fulfilled" ? eventsS.value : null;
  const timeZone = (profileS.status === "fulfilled" && profileS.value?.time_zone) || DEFAULT_TIME_ZONE;
  const outlook: OutlookRead<{ events: OutlookCalendarEvent[] }> | null =
    outlookS.status === "fulfilled" ? outlookS.value : { status: "unavailable" };
  const outlookEvents = outlook?.status === "ok" ? outlook.events : [];
  const outlookNote =
    outlook?.status === "database-update-needed"
      ? "Outlook events aren't switched on for your firm yet. Lectual will turn them on."
      : outlook?.status === "unavailable"
        ? "Outlook events couldn't be loaded."
        : null;

  const readState = calendarReadState({ deadlines, tasks, events: view === "agenda" ? undefined : events });
  const partialNote =
    readState.kind === "partial" ? `Couldn't load ${readState.failed.join(" or ")}, so this calendar is incomplete. Try again shortly.` : null;
  const unavailable = readState.kind === "unavailable";

  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const { needsReview } = splitNeedsReview(deadlines ?? [], now);
  const unconfirmed = new Set((deadlines ?? []).filter((d) => !d.attorney_confirmed).map((d) => `d-${d.id}`));
  // The base read also returns Outlook rows once the database has them; the richer copy wins, so a row never shows twice.
  const outlookIds = new Set(outlookEvents.map((e) => e.id));
  const items = [
    ...rows.map((r) => rowToItem(r, unconfirmed)),
    ...(events ?? []).filter((e) => !outlookIds.has(e.id)).map((e) => eventToItem(e, timeZone)),
    ...outlookEvents.map((e) => outlookToItem(e, timeZone)),
  ];

  const title = view === "agenda" ? "Agenda" : viewTitle(view, anchor);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Calendar</div>
          <h1 className="lx-h1" data-tour="calendar-head">{title}</h1>
          <p className="lx-sub">
            {hasMailbox
              ? "Docket deadlines, task due dates, and events from your connected Outlook calendars."
              : "Docket deadlines and task due dates."}{" "}
            Times are in {timeZone.replaceAll("_", " ")}.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {view !== "agenda" && (
            <div className="lx-cal-nav">
              <Link prefetch={false} href={calendarHref(view, stepAnchor(view, anchor, -1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label="Previous">
                ‹
              </Link>
              <Link prefetch={false} href={calendarHref(view, today)} className="lx-btn lx-btn-sec lx-btn-sm">
                Today
              </Link>
              <Link prefetch={false} href={calendarHref(view, stepAnchor(view, anchor, 1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label="Next">
                ›
              </Link>
            </div>
          )}
          <nav className="lx-view-toggle" aria-label="Calendar view">
            {(["month", "week", "agenda"] as const).map((v) => (
              <Link key={v} prefetch={false} href={calendarHref(v, anchor)} className={view === v ? "on" : undefined} aria-current={view === v ? "page" : undefined}>
                {v === "month" ? "Month" : v === "week" ? "Week" : "Agenda"}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {partialNote && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          {partialNote}
        </p>
      )}

      {outlookNote && (
        <p className="lx-note" role="status" style={{ margin: 0 }}>
          {outlookNote}
        </p>
      )}

      {unavailable && (
        <p className="lx-banner lx-banner-warn" role="alert" style={{ margin: 0 }}>
          This calendar couldn&apos;t be loaded, so nothing is shown. It is not empty. Try again shortly.
        </p>
      )}

      {!unavailable && view === "month" && <MonthView weeks={monthGrid(anchor, today, items)} />}
      {!unavailable && view === "week" && <WeekView days={weekGrid(anchor, today, items)} />}
      {!unavailable && view === "agenda" && <AgendaView rows={rows} needsReview={needsReview} now={now} unconfirmed={unconfirmed} outlook={outlookEvents} timeZone={timeZone} />}

      {!unavailable && view !== "agenda" && (
        <p className="lx-note" style={{ margin: 0 }}>
          <span className="lx-cal-key is-deadline" /> Docket deadline <span className="lx-cal-key is-event" /> Consult or meeting{" "}
          <span className="lx-cal-key is-task" /> Task <span className="lx-cal-key is-overdue" /> Overdue
        </p>
      )}
    </>
  );
}
