import Link from "next/link";
import { getFirmTimeZone } from "@/lib/org/profile";
import { TODAY_CONSULT_DAYS } from "@/lib/calendar/outlook-read";
import { formatEventWhen, joinHref } from "@/lib/calendar/outlook-format";
import { loadTodayConsults, sourceNote, type TodayConsultsResult } from "@/lib/calendar/consult-sources";
import { liveConsultDeps } from "@/lib/calendar/consult-sources-live";

const SOURCE_LABEL = { outlook: "Outlook", zoom: "Zoom" } as const;

/**
 * Today's "Consults" card: consults on the firm's connected Outlook calendars (the daily sync) and its
 * connected Zoom (a live read of upcoming meetings), starting today or in the next 7 days. It always
 * draws something. A list is shown when there are consults; "No consults" only when every source was
 * read; a source that was not connected, not allowed or failed is named with its next step, and the
 * other source's consults still show. Read-only: nothing is sent or booked.
 */
export function TodayConsultsView({ result, timeZone }: { result: TodayConsultsResult; timeZone: string }) {
  const sources = [
    { source: "outlook" as const, state: result.outlook },
    { source: "zoom" as const, state: result.zoom },
  ];
  const notes = sources.map((s) => sourceNote(s.source, s.state)).filter((n): n is NonNullable<typeof n> => n !== null);
  const allRead = notes.length === 0;
  const readOk = sources.filter((s) => s.state === "ok").map((s) => SOURCE_LABEL[s.source]);

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
      {result.consults.length > 0 ? (
        <ul className="lx-list">
          {result.consults.map((c) => {
            const join = joinHref(c.joinUrl);
            return (
              <li key={c.key} className="lx-task">
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{c.title}</span>
                  <span className="lx-note" style={{ display: "block" }}>
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
        <p className="lx-note" style={{ margin: 0 }}>
          No consults in the next {TODAY_CONSULT_DAYS} days.
        </p>
      ) : readOk.length > 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No consults found in {readOk.join(" and ")} in the next {TODAY_CONSULT_DAYS} days.
        </p>
      ) : null}
      {notes.map((n) => (
        <p key={n.source} className="lx-note" role="status" style={{ margin: 0, color: "var(--warn)" }}>
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
