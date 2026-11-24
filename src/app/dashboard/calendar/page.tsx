import { stepLabel, zoneLabel } from "@/lib/calendar/zone-label";
import Link from "next/link";
import { listTasks, listUpcomingDeadlines } from "@/lib/matters";
import { buildCalendarRows, civilDate, type CalendarRow } from "@/lib/matters/calendar-rows";
import { formatDay } from "@/lib/ui/dates";
import { getOrgProfile } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { listCalendarEvents, type CalendarEventRow } from "@/lib/calendar/events";
import { listOutlookCalendarEvents, type OutlookCalendarEvent, type OutlookRead } from "@/lib/calendar/outlook-read";
import { joinHref } from "@/lib/calendar/outlook-format";
import { joinKey } from "@/lib/calendar/consult-sources";
import { sameLeadSameTime } from "@/lib/calendar/booked-merge";
import { orgHasModule } from "@/lib/org/modules";
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
import type { Metadata } from "next";
import { calendarReadState } from "@/lib/calendar/read-state";
import { pageTitle } from "@/lib/ui/page-title";
import { ViewToggle } from "@/components/ViewToggle";
import { Icon, Notice, PageHeader } from "@/components/ui";
import { LoadFailedCard } from "@/components/ui/LoadFailed";
import { LAWMATICS_NAME, NEXT_STEP, REFRESH_TO_TRY_AGAIN } from "@/lib/ui/words";
import "@/components/calendar/calendar.css";
import "./calendar.css";

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
    detail: row.source === "deadline" ? row.detail : NEXT_STEP,
    href: row.href,
    kind: row.source,
    overdue: row.overdueDays > 0,
    unconfirmed: unconfirmed.has(row.key),
  };
}

/** A consult the Lawmatics daily sync stored (its own `lmsync:` rows). */
function isLawmaticsSync(e: CalendarEventRow): boolean {
  return e.source === "lawmatics" && typeof e.external_id === "string" && e.external_id.startsWith("lmsync:");
}

function eventToItem(e: CalendarEventRow, timeZone: string): CalendarItem {
  // All-day events are stored at UTC midnight; their date is the UTC date, not a shifted zoned one.
  const { date, time } = e.all_day && isLawmaticsSync(e) ? { date: e.starts_at.slice(0, 10), time: "" } : zonedParts(e.starts_at, timeZone);
  const who = [e.event_type, e.contact_name].filter(Boolean).join(" · ");
  const fromLawmatics = isLawmaticsSync(e);
  return {
    key: `e-${e.id}`,
    date,
    time: e.all_day ? null : time,
    title: e.title?.trim() || e.event_type || (fromLawmatics ? "Consult" : "Event"),
    // Labelled by where it came from; a Lawmatics consult never has a location (none is stored).
    detail: (fromLawmatics ? [LAWMATICS_NAME, e.event_type] : [who, e.location]).filter(Boolean).join(" · ") || null,
    href: e.lead_id ? `/dashboard/leads/${e.lead_id}/` : e.matter_id ? `/dashboard/matters/${e.matter_id}` : null,
    kind: "event",
    overdue: false,
    unconfirmed: false,
    ...(fromLawmatics ? { consult: e.is_consult === true, joinUrl: joinHref(e.join_url ?? null) } : {}),
  };
}

/** A Lawmatics consult that is the same call as an Outlook event (a shared join link, or the same lead within 15 minutes). */
function twinOfOutlook(e: CalendarEventRow, outlook: readonly OutlookCalendarEvent[]): boolean {
  if (!isLawmaticsSync(e)) return false;
  const key = joinKey(e.join_url ?? null);
  return outlook.some(
    (o) =>
      (key !== null && joinKey(o.join_url) === key) ||
      sameLeadSameTime({ leadId: e.lead_id ?? null, startsAt: e.starts_at }, { leadId: o.lead_id, startsAt: o.starts_at }),
  );
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
      {item.consult && <span className="lx-cal-consult">Consult</span>}
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
      <a href={item.joinUrl} target="_blank" rel="noopener noreferrer" className="lx-cal-detail lx-cal-join">
        Join
      </a>
    </>
  );
}

function MonthView({ weeks, timeZone }: { weeks: GridDay[][]; timeZone: string }) {
  const dayLabel = (date: string) => formatDay(date, { tz: timeZone }) ?? date;
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
              aria-label={`${dayLabel(day.date)}: ${day.items.length} item${day.items.length === 1 ? "" : "s"}`}
            >
              <Link prefetch={false} href={calendarHref("week", day.date)} className="lx-cal-num" aria-label={`Week of ${dayLabel(day.date)}`}>
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

function WeekView({ days, timeZone }: { days: GridDay[]; timeZone: string }) {
  const dayLabel = (date: string) => formatDay(date, { tz: timeZone }) ?? date;
  return (
    <div className="lx-card lx-cal-weekview" aria-label="Week">
      {days.map((day, i) => (
        <section key={day.date} className={`lx-cal-col${day.isToday ? " is-today" : ""}`} aria-label={dayLabel(day.date)}>
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
 * Calendar: a month grid and a week view, over the same
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

  const [deadlinesS, tasksS, profileS, eventsS, outlookS] = await Promise.allSettled([
    listUpcomingDeadlines({}),
    listTasks({ status: "open" }),
    getOrgProfile(),
    listCalendarEvents(range.from, range.to),
    hasMailbox ? listOutlookCalendarEvents(range.from, range.to) : Promise.resolve(null),
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
      ? "Your Outlook calendar isn't showing yet. Lectual will turn it on."
      : outlook?.status === "unavailable"
        ? "We couldn't load your Outlook calendar. Docket dates and tasks are shown."
        : null;

  const readState = calendarReadState({ deadlines, tasks, events });
  const partialNote =
    readState.kind === "partial" ? `Couldn't load ${readState.failed.join(" or ")}, so this calendar is incomplete. Try again shortly.` : null;
  const unavailable = readState.kind === "unavailable";

  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const unconfirmed = new Set((deadlines ?? []).filter((d) => !d.attorney_confirmed).map((d) => `d-${d.id}`));
  // The base read also returns Outlook rows once the database has them; the richer copy wins, so a row never shows twice.
  const outlookIds = new Set(outlookEvents.map((e) => e.id));
  const items = [
    ...rows.map((r) => rowToItem(r, unconfirmed)),
    // A Lawmatics consult that is also on Outlook shows once: the Outlook row is kept.
    ...(events ?? []).filter((e) => !outlookIds.has(e.id) && !twinOfOutlook(e, outlookEvents)).map((e) => eventToItem(e, timeZone)),
    ...outlookEvents.map((e) => outlookToItem(e, timeZone)),
  ];

  const title = viewTitle(view, anchor);

  return (
    <>
      <PageHeader
        title={title}
        tour="calendar-head"
        sub={
          <>
            {hasMailbox
              ? "Docket deadlines, task due dates, and events from your connected Outlook calendars."
              : "Docket deadlines and task due dates."}{" "}
            Times are in {zoneLabel(timeZone)}.
          </>
        }
        actions={
          <div className="lx-cal-controls">
            <div className="lx-cal-nav">
              <Link prefetch={false} href={calendarHref(view, stepAnchor(view, anchor, -1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label={stepLabel("previous", view)}>
                <Icon name="chevron-left" />
              </Link>
              <Link prefetch={false} href={calendarHref(view, today)} className="lx-btn lx-btn-sec lx-btn-sm">
                Today
              </Link>
              <Link prefetch={false} href={calendarHref(view, stepAnchor(view, anchor, 1))} className="lx-btn lx-btn-sec lx-btn-sm" aria-label={stepLabel("next", view)}>
                <Icon name="chevron-right" />
              </Link>
            </div>
            <ViewToggle<"month" | "week">
              label="Calendar view"
              value={view}
              views={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]}
              hrefFor={(v) => calendarHref(v, anchor)}
              prefetch={false}
            />
          </div>
        }
      />

      {partialNote && <Notice tone="warn">{partialNote}</Notice>}

      {outlookNote && (
        <p className="lx-note" role="status">
          {outlookNote}
        </p>
      )}

      {unavailable && <LoadFailedCard role="alert" what="this calendar" body={REFRESH_TO_TRY_AGAIN} />}

      {!unavailable && view === "month" && <MonthView weeks={monthGrid(anchor, today, items)} timeZone={timeZone} />}
      {!unavailable && view === "week" && <WeekView days={weekGrid(anchor, today, items)} timeZone={timeZone} />}

      {!unavailable && (
        <p className="lx-note">
          <span className="lx-cal-key is-deadline" /> Docket deadline <span className="lx-cal-key is-event" /> Consult or meeting{" "}
          <span className="lx-cal-key is-task" /> {NEXT_STEP} <span className="lx-cal-key is-overdue" /> Overdue
        </p>
      )}
    </>
  );
}
