import type { AssessmentResults } from "@/lib/intake-forms/results";

/**
 * The assessment distributions, drawn from `AssessmentResults`: one set of
 * blocks for an intake assessment's Results tab and for a booth event's page,
 * because both are built into the same shape first. Presentational and
 * read-only. Hot, warm and cold are for staff, and are labelled so.
 */

const pct = (n: number, max: number) => (max > 0 ? Math.round((n / max) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Bars({ rows, label }: { rows: { label: string; count: number }[]; label: string }) {
  const max = Math.max(0, ...rows.map((r) => r.count));
  return (
    <ul className="ifr-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} className="ifr-bar-row">
          <span className="ifr-bar-label">{r.label}</span>
          <span className="ifr-bar" aria-hidden>
            <i style={{ width: `${pct(r.count, max)}%` }} />
          </span>
          <span className="ifr-bar-count">{r.count.toLocaleString("en-US")}</span>
        </li>
      ))}
    </ul>
  );
}

export function AssessmentBlocks({ results, who }: { results: AssessmentResults; who: string }) {
  if (results.finished === 0) {
    return (
      <div className="ifm-card ifr-block">
        <h3 className="ifm-title">Scores and answers</h3>
        <p className="ifm-help">
          {`Nobody has finished the assessment in this range, so there are no scores to chart.`}
          {results.unfinished > 0 ? ` ${plural(results.unfinished, "person", "people")} gave contact details and didn't finish.` : ""}
        </p>
      </div>
    );
  }
  const maxBucket = Math.max(0, ...results.buckets.map((b) => b.count));
  return (
    <>
      <p className="ifm-help">
        {`${plural(results.finished, "person", "people")} finished${who ? ` ${who}` : ""}.`}
        {results.unfinished > 0 ? ` ${results.unfinished.toLocaleString("en-US")} more gave contact details and didn't finish. They are not in the charts below.` : ""}
      </p>

      <div className="ifr-grid">
        <div className="ifm-card ifr-block">
          <h3 className="ifm-title">Score bands</h3>
          <Bars rows={results.bands} label="People by score band" />
        </div>
        <div className="ifm-card ifr-block">
          <h3 className="ifm-title">Hot, warm and cold</h3>
          <Bars
            rows={[
              { label: "Hot", count: results.temperatures.hot },
              { label: "Warm", count: results.temperatures.warm },
              { label: "Cold", count: results.temperatures.cold },
            ]}
            label="People by temperature"
          />
          <p className="ifm-help">Staff only. The person never sees this.</p>
        </div>
      </div>

      <div className="ifm-card ifr-block">
        <h3 className="ifm-title">Score distribution</h3>
        <div className="ifr-buckets" role="img" aria-label="People by score, in ten-point steps">
          {results.buckets.map((b) => (
            <div key={b.label} className="ifr-bucket">
              <b>{b.count.toLocaleString("en-US")}</b>
              <i style={{ height: `${Math.max(pct(b.count, maxBucket), b.count > 0 ? 4 : 0)}%` }} />
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ifm-card ifr-block">
        <h3 className="ifm-title">Most common gaps</h3>
        {results.gaps.length === 0 ? (
          <p className="ifm-help">{results.gapsRead === 0 ? "No gaps could be read for this range." : "Nobody had a gap to report."}</p>
        ) : (
          <ol className="ifr-gaps">
            {results.gaps.map((g) => (
              <li key={g.text}>
                {g.text} <b>{`· ${plural(g.count, "person", "people")}`}</b>
              </li>
            ))}
          </ol>
        )}
        <p className="ifm-help">
          {`Counted over ${plural(results.gapsRead, "person", "people")}.`}
          {results.gapsUnread > 0 ? ` Gaps unavailable for ${results.gapsUnread.toLocaleString("en-US")}: their answers couldn't be matched to the assessment as it stands.` : ""}
        </p>
      </div>

      <div className="ifr-grid">
        {results.questions.map((q) => (
          <div key={q.id} className="ifm-card ifr-block">
            <h3 className="ifm-title">{q.question}</h3>
            <Bars rows={q.options.map((o) => ({ label: o.label, count: o.count }))} label={`Answers to ${q.question}`} />
            {q.other.length > 0 && (
              <p className="ifm-help">{`Other answers, as stored: ${q.other.map((o) => `${o.value} (${o.count})`).join(", ")}.`}</p>
            )}
            <p className="ifm-help">{`${plural(q.answered, "answer", "answers")}.`}</p>
          </div>
        ))}
      </div>
    </>
  );
}
