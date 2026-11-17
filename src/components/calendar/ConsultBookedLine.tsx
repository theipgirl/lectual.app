import type { OutlookCalendarEvent, OutlookRead } from "@/lib/calendar/outlook-read";
import "./calendar.css";
import { formatEventWhen, joinHref } from "@/lib/calendar/outlook-format";

/**
 * "Consult booked · Thu, Oct 22, 2:00 PM · Join" for a lead with a future
 * consult on a connected Outlook calendar. Three states: a failed read or a
 * database that hasn't had the calendar update says so in a muted line, and is
 * never drawn as "no consult". No booking, no line.
 */
export function ConsultBookedView({
  read,
  timeZone,
  bare = false,
}: {
  read: OutlookRead<{ event: OutlookCalendarEvent | null }>;
  timeZone: string;
  /** Inside the lead page's "Needs attention" card: a plain row, not a card of its own. */
  bare?: boolean;
}) {
  if (read.status === "database-update-needed") {
    return (
      <p className="lx-note">
        Consult bookings from Outlook aren&apos;t switched on for your firm yet. Lectual will turn them on.
      </p>
    );
  }
  if (read.status === "unavailable") {
    return (
      <p className="lx-note" role="status">
        We couldn&apos;t check whether a consult is booked. This doesn&apos;t mean there isn&apos;t one.
      </p>
    );
  }
  if (!read.event) return null;
  const join = joinHref(read.event.join_url);
  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper
      className={bare ? "lx-booked" : "lx-card lx-booked lx-booked-card"}
      aria-label="Consult booked"
    >
      <b className="lx-booked-title">Consult booked</b>
      <span className="lx-note">
        {" · "}
        {formatEventWhen(read.event, timeZone)}
      </span>
      {join && (
        <>
          <span className="lx-note">{" · "}</span>
          <a href={join} target="_blank" rel="noopener noreferrer" className="lx-cal-join">
            Join
          </a>
        </>
      )}
    </Wrapper>
  );
}
