import type { OutlookCalendarEvent, OutlookRead } from "@/lib/calendar/outlook-read";
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
}: {
  read: OutlookRead<{ event: OutlookCalendarEvent | null }>;
  timeZone: string;
}) {
  if (read.status === "database-update-needed") {
    return (
      <p className="lx-note" style={{ margin: 0 }}>
        Consult bookings from Outlook aren&apos;t switched on for your firm yet. Lectual will turn them on.
      </p>
    );
  }
  if (read.status === "unavailable") {
    return (
      <p className="lx-note" style={{ margin: 0 }} role="status">
        We couldn&apos;t check whether a consult is booked. This doesn&apos;t mean there isn&apos;t one.
      </p>
    );
  }
  if (!read.event) return null;
  const join = joinHref(read.event.join_url);
  return (
    <section className="lx-card" style={{ padding: "12px 18px", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }} aria-label="Consult booked">
      <b style={{ color: "var(--ink)" }}>Consult booked</b>
      <span className="lx-note">
        {" · "}
        {formatEventWhen(read.event, timeZone)}
      </span>
      {join && (
        <>
          <span className="lx-note">{" · "}</span>
          <a href={join} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, color: "var(--ox)" }}>
            Join
          </a>
        </>
      )}
    </section>
  );
}
