import Link from "next/link";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { civilInZone } from "@/lib/today/outcomes";
import { getFirmTimeZone } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { deadlineCardGroups, isRecipient, type AlertDeadline, type DeadlineCardGroups, type RecipientRead } from "@/lib/today/deadline-alerts";
import { loadAlertDeadlines, loadAlertRecipients, raiseOwnDeadlineNotices } from "@/lib/today/deadline-alerts-store";
import {
  DEADLINE_ALERTS_UNCHECKED,
  DEADLINE_CARD_CUT,
  DEADLINE_CARD_OPEN_CALENDAR,
  DEADLINE_CARD_FAILED,
  DEADLINE_CARD_HEADING,
  DEADLINE_CARD_MONTH,
  DEADLINE_CARD_NONE,
  DEADLINE_CARD_OVERDUE,
  DEADLINE_CARD_WEEK,
  DEADLINE_UNCONFIRMED,
  deadlineCardMore,
} from "@/lib/ui/words";
import "./today.css";

/** Rows the card lists per group before "and N more". */
export const DEADLINE_CARD_SHOWN = 8;

function addDays(civil: string, days: number): string {
  const d = new Date(`${civil}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Group({ id, title, rows, tone }: { id: string; title: string; rows: AlertDeadline[]; tone: "risk" | "warn" | "mute" }) {
  if (rows.length === 0) return null;
  return (
    <div className="td-dl-group" data-group={id}>
      <h3 className="lx-label td-pad">
        {title} · {rows.length}
      </h3>
      <ul className="lx-list td-list">
        {rows.slice(0, DEADLINE_CARD_SHOWN).map((d) => (
          <li key={d.id} className="lx-task" data-deadline={d.id}>
            <span className="td-body">
              <Link prefetch={false} href={`/dashboard/matters/${d.matterId}/`} className="lx-rowlink">
                {d.title}
              </Link>
              <span className="lx-note td-sub">{`${d.matterLabel} · due ${formatCivilDate(d.dueDate) ?? d.dueDate}`}</span>
            </span>
            <span className="td-dl-pills">
              {!d.confirmed && <Pill tone="warn">{DEADLINE_UNCONFIRMED}</Pill>}
              <Pill tone={tone}>{formatCivilDate(d.dueDate) ?? d.dueDate}</Pill>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > DEADLINE_CARD_SHOWN && <p className="lx-note td-pad-end">{deadlineCardMore(rows.length - DEADLINE_CARD_SHOWN)}</p>}
    </div>
  );
}

/**
 * The card's markup, from what was read. `recipients` unavailable says the alerts couldn't be checked (never "no
 * alerts"); a viewer who is not a recipient gets nothing; `groups` null is "Couldn't load", never "No deadlines".
 */
export function DeadlineAlertsView({ recipients, viewerId, groups, cutShort = false }: { recipients: RecipientRead; viewerId: string; groups: DeadlineCardGroups | null; /** A read reached its cap. */ cutShort?: boolean }) {
  const member = isRecipient(recipients, viewerId);
  if (member === false) return null;
  const total = groups ? groups.overdue.length + groups.week.length + groups.month.length : null;
  return (
    <section className="lx-card lx-band" aria-labelledby="today-deadlines" data-card="deadline-alerts">
      <header className="lx-band-head">
        <h2 id="today-deadlines" className="lx-h2">
          {DEADLINE_CARD_HEADING}
        </h2>
        {member && total !== null && <span className="lx-note">{total}</span>}
      </header>
      {member === null ? (
        <div className="td-pad-end">
          <LoadFailedLine role="alert" refresh={false}>{DEADLINE_ALERTS_UNCHECKED}</LoadFailedLine>
        </div>
      ) : groups === null ? (
        <div className="td-pad-end">
          <LoadFailedLine role="alert" refresh={false}>{DEADLINE_CARD_FAILED}</LoadFailedLine>
        </div>
      ) : total === 0 && !cutShort ? (
        <p className="lx-note td-pad-end">{DEADLINE_CARD_NONE}</p>
      ) : (
        <>
          <Group id="overdue" title={DEADLINE_CARD_OVERDUE} rows={groups.overdue} tone="risk" />
          <Group id="week" title={DEADLINE_CARD_WEEK} rows={groups.week} tone="warn" />
          <Group id="month" title={DEADLINE_CARD_MONTH} rows={groups.month} tone="mute" />
          {cutShort && (
            <p className="lx-note td-pad-end" role="status" data-cut-short="">
              {DEADLINE_CARD_CUT}{" "}
              <Link prefetch={false} href="/dashboard/calendar/">
                {DEADLINE_CARD_OPEN_CALENDAR}
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

export type DeadlineAlertsData = { recipients: RecipientRead; groups: DeadlineCardGroups | null; cutShort: boolean };

/**
 * Today's "Deadlines" card data (PGE Sprint 3 Part A): drawn only for the members chosen in Settings -> Team. Its own
 * reads (scoped client); for a recipient it also raises their own bell notices for deadlines that entered the 30- or
 * 7-day window (once each, see deadline-alerts.ts). Never throws. The Today pages START this beside their other reads
 * and await it with them, so it never runs after them.
 */
export async function loadDeadlineAlerts(userId: string, now: Date = new Date()): Promise<DeadlineAlertsData> {
  try {
    const [recipients, tz] = await Promise.all([loadAlertRecipients(), getFirmTimeZone().catch(() => DEFAULT_TIME_ZONE)]);
    if (recipients.status !== "ok" || isRecipient(recipients, userId) === false) return { recipients, groups: null, cutShort: false };
    const today = civilInZone(now, tz);
    const read = await loadAlertDeadlines(today, addDays(today, 30));
    if (read) await raiseOwnDeadlineNotices(userId, read.deadlines, today);
    return { recipients, groups: read ? deadlineCardGroups(read.deadlines, today) : null, cutShort: read ? read.cutShort.upcoming || read.cutShort.overdue : false };
  } catch {
    return { recipients: { status: "unavailable" }, groups: null, cutShort: false };
  }
}

/** The card from what `loadDeadlineAlerts` read (nothing for a non-recipient). */
export function DeadlineAlertsCard({ data, userId }: { data: DeadlineAlertsData; userId: string }) {
  return <DeadlineAlertsView recipients={data.recipients} viewerId={userId} groups={data.groups} cutShort={data.cutShort} />;
}
