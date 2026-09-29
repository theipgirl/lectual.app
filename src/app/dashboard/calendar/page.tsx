import Link from "next/link";
import { listTasks, listUpcomingDeadlines } from "@/lib/matters";
import { buildCalendarRows, civilDate, groupCalendarRows, type CalendarRow } from "@/lib/matters/calendar-rows";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { getOrgProfile } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { listCalendarEvents, type CalendarEventRow } from "@/lib/calendar/events";
import {
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

function Chip({ item, compact }: { item: CalendarItem; compact: boolean }) {
  const cls = `lx-cal-item is-${item.kind}${item.overdue ? " is-overdue" : ""}`;
  const label = (
    <>
      {item.time && <span className="lx-cal-time">{shortTime(item.time)}</span>}
      <span className="lx-cal-title">{item.title}</span>
      {!compact && item.detail && <span className="lx-cal-detail">{item.detail}</span>}
      {!compact && item.unconfirmed && <span className="lx-cal-detail">Unconfirmed</span>}
    </>
  );
  const title = [item.time ? shortTime(item.time) : null, item.title, item.detail, item.unconfirmed ? "unconfirmed" : null]
    .filter(Boolean)
    .join(" · ");
  return item.href ? (
    <Link href={item.href} className={cls} title={title}>
      {label}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {label}
    </span>
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
              <Link href={calendarHref("week", day.date)} className="lx-cal-num" aria-label={`Week of ${formatCivilDate(day.date) ?? day.date}`}>
                {day.day}
              </Link>
              {day.items.slice(0, MONTH_CELL_LIMIT).map((item) => (
                <Chip key={item.key} item={item} compact />
              ))}
              {day.items.length > MONTH_CELL_LIMIT && (
                <Link href={calendarHref("week", day.date)} className="lx-cal-more">
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

function AgendaView({ rows, now, unconfirmed }: { rows: CalendarRow[]; now: Date; unconfirmed: Set<string> }) {
  const groups = groupCalendarRows(rows, now);
  if (groups.length === 0) {
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
                  <Link href={r.href} className="lx-rowlink">
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
    </>
  );
}

/**
 * Calendar: a month grid, a week view and the agenda list, over the same three
 * sources — open docket deadlines, open task due dates, and consults and
 * meetings from crm_calendar_event (Lawmatics sync). Timed events are placed
 * in the firm's own time zone (Settings → Firm profile).
 *
 * Each source is read separately and a failed read is SAID, never drawn as an
 * empty day: a blank grid over a broken read would tell a firm nothing is due.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  const params = await searchParams;
  const view = parseCalendarView(params.view);
  const now = new Date();
  const today = civilDate(now);
  const anchor = isCivilDate(params.d) ? params.d : today;
  const range = viewRange(view, anchor);

  const [deadlinesS, tasksS, profileS, eventsS] = await Promise.allSettled([
    listUpcomingDeadlines({}),
    listTasks({ status: "open" }),
    getOrgProfile(),
    view === "agenda" ? Promise.resolve([] as CalendarEventRow[]) : listCalendarEvents(range.from, range.to),
  ]);
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const tasks = tasksS.status === "fulfilled" ? tasksS.value : null;
  const events = eventsS.status === "fulfilled" ? eventsS.value : null;
  const timeZone = (profileS.status === "fulfilled" && profileS.value?.time_zone) || DEFAULT_TIME_ZONE;

  const failed = [deadlines === null && "docket dates", tasks === null && "tasks", events === null && "consults and meetings"].filter(
    Boolean,
  ) as string[];
  const partialNote = failed.length ? `Couldn't load ${failed.join(" or ")}, so this calendar is incomplete. Try again shortly.` : null;

  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const unconfirmed = new Set((deadlines ?? []).filter((d) => !d.attorney_confirmed).map((d) => `d-${d.id}`));
  const items = [...rows.map((r) => rowToItem(r, unconfirmed)), ...(events ?? []).map((e) => eventToItem(e, timeZone))];

  const title = view === "agenda" ? "Agenda" : viewTitle(view, anchor);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Calendar</div>
          <h1 className="lx-h1">{title}</h1>
          <p className="lx-sub">
            Docket deadlines, task due dates, and consults and meetings synced from Lawmatics. Times are in {timeZone.replaceAll("_", " ")}.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {view !== "agenda" && (
            <div className="lx-cal-nav">
              <Link href={calendarHref(view, stepAnchor(view, anchor, -1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label="Previous">
                ‹
              </Link>
              <Link href={calendarHref(view, today)} className="lx-btn lx-btn-sec lx-btn-sm">
                Today
              </Link>
              <Link href={calendarHref(view, stepAnchor(view, anchor, 1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label="Next">
                ›
              </Link>
            </div>
          )}
          <nav className="lx-view-toggle" aria-label="Calendar view">
            {(["month", "week", "agenda"] as const).map((v) => (
              <Link key={v} href={calendarHref(v, anchor)} className={view === v ? "on" : undefined} aria-current={view === v ? "page" : undefined}>
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

      {view === "month" && <MonthView weeks={monthGrid(anchor, today, items)} />}
      {view === "week" && <WeekView days={weekGrid(anchor, today, items)} />}
      {view === "agenda" && (deadlines !== null || tasks !== null) && <AgendaView rows={rows} now={now} unconfirmed={unconfirmed} />}

      {view !== "agenda" && (
        <p className="lx-note" style={{ margin: 0 }}>
          <span className="lx-cal-key is-deadline" /> Docket deadline <span className="lx-cal-key is-event" /> Consult or meeting{" "}
          <span className="lx-cal-key is-task" /> Task <span className="lx-cal-key is-overdue" /> Overdue
        </p>
      )}
    </>
  );
}
