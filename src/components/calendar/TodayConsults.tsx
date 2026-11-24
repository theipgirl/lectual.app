import Link from "next/link";
import { getFirmTimeZone } from "@/lib/org/profile";
import { TODAY_CONSULT_DAYS } from "@/lib/calendar/outlook-read";
import { formatEventWhen, joinHref } from "@/lib/calendar/outlook-format";
import { consultSources, loadTodayConsults, sourceNote, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { LAWMATICS_NAME } from "@/lib/ui/words";
import { liveConsultDeps } from "@/lib/calendar/consult-sources-live";
import "./calendar.css";

const SOURCE_LABEL = { outlook: "Outlook", lawmatics: LAWMATICS_NAME, zoom: "Zoom" } as const;

/**
 * Today's "Consults" card: consults on the firm's connected Outlook calendars (the daily sync), the consults the
 * Lawmatics daily sync stored, and its connected Zoom (a live read of upcoming meetings), starting today or in the next 7 days. It always
 * draws something. A list is shown when there are consults; "No consults" only when every source was
 * read; a source that was not connected, not allowed or failed is named with its next step, and the
 * other source's consults still show. Read-only: nothing is sent or booked.
 */
export function TodayConsultsView({ result, timeZone }: { result: TodayConsultsResult; timeZone: string }) {
  const sources = consultSources(result);
  const notes = sources.map((s) => sourceNote(s.source, s.state)).filter((n): n is NonNullable<typeof n> => n !== null);
  const allRead = notes.length === 0;
  const readOk = sources.filter((s) => s.state === "ok").map((s) => SOURCE_LABEL[s.source]);

  return (
    <section className="lx-card lx-pad lx-consults-card" aria-labelledby="today-consults-h">
      <div className="lx-consults-head">
        <h2 id="today-consults-h" className="lx-h2">
          Consults
        </h2>
        <Link href="/dashboard/calendar/" className="lx-note">
          Calendar →
        </Link>
      </div>
      {result.consults.length > 0 ? (
        <ul className="lx-list">
          {result.consults.map((c) => {
            const join = joinHref(c.joinUrl);
            return (
              <li key={c.key} className="lx-task">
                <span className="lx-consults-text">
                  <span className="lx-consults-title">{c.title}</span>
                  <span className="lx-note lx-consults-when">
                    {formatEventWhen({ starts_at: c.startsAt, all_day: c.allDay }, timeZone)}
                    {c.leadId && (
                      <>
                        {" · "}
                        <Link href={`/dashboard/leads/${c.leadId}/`}>{c.leadName ?? "Open lead"}</Link>
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
      ) : allRead ? (
        <p className="lx-note">
          No consults in the next {TODAY_CONSULT_DAYS} days.
        </p>
      ) : readOk.length > 0 ? (
        <p className="lx-note">
          No consults found in {readOk.join(", ").replace(/, ([^,]*)$/, " and $1")} in the next {TODAY_CONSULT_DAYS} days.
        </p>
      ) : null}
      {notes.map((n) => (
        <p key={n.source} className="lx-note lx-consults-warn" role="status">
          {n.text}
          {n.link && (
            <>
              {" "}
              <Link href={n.link.href}>{n.link.label}</Link>
            </>
          )}
        </p>
      ))}
    </section>
  );
}

/** Self-loading, so Today's page only mounts it. It never renders nothing. */
export async function TodayConsults() {
  const timeZone = await getFirmTimeZone();
  const result = await loadTodayConsults(new Date(), timeZone, liveConsultDeps);
  return <TodayConsultsView result={result} timeZone={timeZone} />;
}
