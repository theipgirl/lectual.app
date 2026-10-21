import Link from "next/link";
import { eventSummaries } from "@/lib/intake-forms/booth-results";
import { formatDuration } from "@/lib/intake-forms/performance";
import { EVENT_LIST_ROW_LIMIT, type loadBoothEventList } from "@/lib/intake-forms/load-results";

/**
 * The Forms list's "Event assessments": one read-only row per booth event code
 * in this firm's `crm_booth_scorecard`, all time. These are not intakes: a
 * booth card is taken on the firm's own device, so there is nothing to create,
 * edit, archive or copy here, only numbers and a link to the event's results.
 *
 * The read is three-state. A firm with no booth cards sees no section at all;
 * a failed read says so (it is not "none" and not a row of zeros); a missing
 * table is a quiet line.
 */

export function eventHref(code: string, range?: string) {
  return `/dashboard/forms/?event=${encodeURIComponent(code)}${range ? `&range=${range}` : ""}`;
}

export function EventAssessments({ read }: { read: Awaited<ReturnType<typeof loadBoothEventList>> }) {
  if (read.status === "unconfigured") {
    return (
      <p className="ifm-help">
        Event assessments aren&apos;t set up in this environment (lectual migration 0086). Nothing is broken; it needs the migration.
      </p>
    );
  }
  if (read.status === "unavailable") {
    return (
      <div role="status" className="lx-banner lx-banner-warn" style={{ fontSize: 14 }}>
        Event assessments couldn&apos;t be loaded. This is a problem reaching the database, not an empty list. Try again shortly.
      </div>
    );
  }
  const events = eventSummaries(read.value.rows);
  if (events.length === 0) return null;
  return (
    <section className="ifl-root ife-section" aria-label="Event assessments">
      <div className="ife-head">
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          Event assessments
        </h2>
        <span className="ifm-help">From booth scorecards taken at events. Read-only, all time.</span>
      </div>
      <div className="ifl-list" style={{ marginTop: 12 }}>
        {events.map((e) => (
          <article key={e.code} className="lx-card ifl-item">
            <div className="ifl-main">
              <div className="ifl-title-row">
                <Link href={eventHref(e.code)} className="ifl-name">
                  {e.code}
                </Link>
                <span className="ifl-kind">Booth assessment</span>
              </div>
            </div>
            <dl className="ifl-stats" aria-label={`${e.code}, all time`}>
              <div>
                <dt>Started</dt>
                <dd>{e.started.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>
                  {e.finished.toLocaleString("en-US")}
                  {e.started > 0 && <small> {e.completionRate}</small>}
                </dd>
              </div>
              <div>
                <dt>Median time</dt>
                <dd>{formatDuration(e.medianMs)}</dd>
              </div>
            </dl>
            <div className="ifl-actions">
              <Link className="ifl-act" href={eventHref(e.code)}>
                Results
              </Link>
            </div>
          </article>
        ))}
      </div>
      {read.value.capped && <p className="ifm-help">{`Numbers cover the latest ${EVENT_LIST_ROW_LIMIT.toLocaleString("en-US")} booth cards.`}</p>}
    </section>
  );
}
