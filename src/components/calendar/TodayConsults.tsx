import Link from "next/link";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { loadConsultsForToday, TODAY_CONSULT_DAYS, type TodayConsult, type OutlookRead } from "@/lib/calendar/outlook-read";
import { formatEventWhen, joinHref } from "@/lib/calendar/outlook-format";

/**
 * Today's "Consults" card: consults on the firm's connected Outlook calendars
 * starting today or in the next 7 days. Three states: an empty list is shown
 * only when the read succeeded and found none; a failed read and a database
 * without the calendar update each say so. Read-only: nothing is sent or booked.
 */
export function TodayConsultsView({
  read,
  timeZone,
}: {
  read: OutlookRead<{ consults: TodayConsult[] }>;
  timeZone: string;
}) {
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }} aria-labelledby="today-consults-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <h2 id="today-consults-h" className="lx-h2" style={{ fontSize: 25 }}>
          Consults
        </h2>
        <Link href="/dashboard/calendar/" className="lx-note">
          Calendar →
        </Link>
      </div>
      {read.status === "database-update-needed" ? (
        <p className="lx-note" style={{ margin: 0 }}>
          Consults from Outlook aren&apos;t available until the database update.
        </p>
      ) : read.status === "unavailable" ? (
        <p className="lx-note" role="status" style={{ margin: 0, color: "var(--warn)" }}>
          Consults couldn&apos;t be loaded. This is not an empty calendar. Try again shortly.
        </p>
      ) : read.consults.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No consults in the next {TODAY_CONSULT_DAYS} days.
        </p>
      ) : (
        <ul className="lx-list">
          {read.consults.map((c) => {
            const join = joinHref(c.join_url);
            return (
              <li key={c.id} className="lx-task">
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{c.title?.trim() || "Consult"}</span>
                  <span className="lx-note" style={{ display: "block" }}>
                    {formatEventWhen(c, timeZone)}
                    {c.lead_id && (
                      <>
                        {" · "}
                        <Link href={`/dashboard/leads/${c.lead_id}/`}>{c.lead_name ?? "Open lead"}</Link>
                      </>
                    )}
                  </span>
                </span>
                {join && (
                  <a href={join} target="_blank" rel="noopener noreferrer" className="lx-btn lx-btn-sec lx-btn-sm">
                    Join
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Self-loading, so Today's page only mounts it. No mailbox module: nothing, and no read. */
export async function TodayConsults() {
  if (!(await orgHasModule("mailbox"))) return null;
  const timeZone = await getFirmTimeZone();
  const read = await loadConsultsForToday(new Date(), timeZone);
  return <TodayConsultsView read={read} timeZone={timeZone} />;
}
