import Link from "next/link";
import { notFound } from "next/navigation";
import {
  EVENT_RANGES,
  boothCardQuestions,
  dropOffByQuestion,
  eventStats,
  eventVariant,
  inEventRange,
  sampleFromBooth,
  type EventRange,
} from "@/lib/intake-forms/booth-results";
import { formatDuration } from "@/lib/intake-forms/performance";
import { loadBoothEvent, EVENT_ROW_LIMIT } from "@/lib/intake-forms/load-results";
import { assessmentResults } from "@/lib/intake-forms/results";
import { AssessmentBlocks } from "./AssessmentBlocks";
import { Unreadable } from "./IntakeDrawer";
import { eventHref } from "./EventAssessments";

/**
 * `/dashboard/forms/?event=<code>`: one booth event's numbers, read-only. The
 * same Performance cards and Results blocks as an intake assessment, fed from
 * the event's booth scorecards, plus where unfinished cards stopped.
 *
 * The event's cards are read all time and the range is applied here, so an
 * event with nothing in the range is still a known event; a code with no cards
 * at all in this firm is `notFound()`. A failed read is the three-state
 * warning, never an empty page.
 */

const RANGE_LABEL = (r: EventRange) => (r === "all" ? "All time" : `${r} days`);

export async function EventPage({ code, range, now = new Date() }: { code: string; range: EventRange; now?: Date }) {
  const read = await loadBoothEvent(code);
  if (read.status === "ok" && read.value.rows.length === 0) notFound();

  const header = (
    <>
      <Link href="/dashboard/forms/" className="ifm-back">
        ← All intakes
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="lx-label">Event assessment</div>
          <h1 className="lx-h1">{code}</h1>
          <p className="lx-sub">Booth scorecards taken at this event. Read-only: nothing here changes a card or a lead.</p>
        </div>
        <nav className="ifm-seg" aria-label="Date range">
          {EVENT_RANGES.map((r) => (
            <Link key={r} href={eventHref(code, String(r))} scroll={false} className={range === r ? "on" : ""} aria-current={range === r ? "page" : undefined}>
              {RANGE_LABEL(r)}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );

  if (read.status !== "ok") {
    return (
      <div className="ifm-root">
        {header}
        <Unreadable what="This event's scorecards" unconfigured={read.status === "unconfigured"} />
      </div>
    );
  }

  const rows = inEventRange(read.value.rows, range, now);
  const stats = eventStats(rows);
  const variant = eventVariant(read.value.rows);
  const results = assessmentResults(rows.map(sampleFromBooth), boothCardQuestions(variant, "business"));
  const drop = dropOffByQuestion(rows, variant);
  const maxDrop = Math.max(0, ...drop.steps.map((s) => s.count));

  return (
    <div className="ifm-root">
      {header}
      <div className="ifm-perf">
        <h2 className="ifm-title">Performance</h2>
        <div className="ifm-stats" role="group" aria-label="Booth cards at this event">
          {[
            { label: "Started", value: stats.started.toLocaleString("en-US"), sub: "Gave contact details at the booth" },
            { label: "Finished", value: stats.finished.toLocaleString("en-US"), sub: "Completed the card" },
            { label: "Completion rate", value: stats.completionRate, sub: "Of those who started" },
            { label: "Median time to finish", value: formatDuration(stats.medianMs), sub: "From contact details to the last answer" },
          ].map((k) => (
            <div key={k.label} className="ifm-card ifm-kpi">
              <div className="ifm-field-label">{k.label}</div>
              <div className="ifm-kpi-value">{k.value}</div>
              <div className="ifm-help">{k.sub}</div>
            </div>
          ))}
        </div>
        {read.value.capped && <p className="ifm-help">{`Numbers cover the latest ${EVENT_ROW_LIMIT.toLocaleString("en-US")} cards.`}</p>}

        <h2 className="ifm-title">Results</h2>
        <AssessmentBlocks results={results} who={range === "all" ? "at this event" : `at this event in the last ${range} days`} />

        <h2 className="ifm-title">Drop-off by question</h2>
        <div className="ifm-card ifr-block">
          {drop.unfinished === 0 ? (
            <p className="ifm-help">Everyone who gave contact details finished the card in this range.</p>
          ) : !drop.recorded ? (
            <p className="ifm-help">
              {`${drop.unfinished.toLocaleString("en-US")} ${drop.unfinished === 1 ? "card was" : "cards were"} started and not finished. Answers are saved when a card is finished, so where people stopped isn't recorded for these cards.`}
            </p>
          ) : (
            <>
              <p className="ifm-help">
                {`${drop.unfinished.toLocaleString("en-US")} ${drop.unfinished === 1 ? "card was" : "cards were"} started and not finished. Each is counted at the first question it has no answer for.`}
              </p>
              <ul className="ifr-bars" aria-label="Unfinished cards by the question they stopped at">
                {drop.steps.map((s) => (
                  <li key={s.id} className="ifr-bar-row">
                    <span className="ifr-bar-label">{s.question}</span>
                    <span className="ifr-bar" aria-hidden>
                      <i style={{ width: `${maxDrop > 0 ? Math.round((s.count / maxDrop) * 100) : 0}%` }} />
                    </span>
                    <span className="ifr-bar-count">{s.count.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
              {drop.atEnd > 0 && <p className="ifm-help">{`${drop.atEnd.toLocaleString("en-US")} answered every question but weren't marked finished.`}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
