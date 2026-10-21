import { FIRM_TIME_ZONE } from "@/lib/quotes/firm-time";
import { formatIntakeTime } from "@/lib/intake-forms/performance";
import { scoreLine, mergeAnswerItems, type AnswerItem, type ScoreSummary } from "@/lib/answers/items";
import type { AnswersRead, SourceRead } from "@/lib/answers/load-answers";

/**
 * "Intake & assessment answers": what this person (lead page) or this matter
 * (matter page) told the firm, newest first, each item opening to its full
 * answers. Presentational: it takes the result of the reads
 * (`src/lib/answers/load-answers.ts`), so it renders without a database.
 *
 * States are never collapsed. A source that failed is named in a warning and
 * the sources that loaded are still shown; a source whose table is not in this
 * environment gets its own quiet line; "No intake or assessment answers yet."
 * appears only when every source we asked came back empty.
 *
 * The temperature is staff-only. These are staff pages, and it is labelled so.
 */

const TITLE = "Intake & assessment answers";
export const EMPTY_LINE = "No intake or assessment answers yet.";

const SOURCES = [
  { key: "submissions", name: "Intake submissions" },
  { key: "booth", name: "Booth scorecards" },
  { key: "requests", name: "Questions sent to the client" },
] as const;

function Answers({ pairs, finished }: { pairs: AnswerItem["pairs"]; finished: boolean }) {
  if (!finished) return null;
  if (pairs.length === 0) return <p className="lx-note" style={{ margin: 0 }}>No answers were recorded.</p>;
  return (
    <dl style={{ margin: 0, display: "grid", gap: 8 }}>
      {pairs.map((p, i) => (
        <div key={i}>
          <dt className="lx-note">{p.question}</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{p.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

function Result({ summary }: { summary: ScoreSummary }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {scoreLine(summary) && (
        <div className="lx-meta">
          <span>Result</span>
          <span>{scoreLine(summary)}</span>
        </div>
      )}
      {summary.temperature && (
        <div className="lx-meta">
          <span>Temperature (staff only)</span>
          <span>{summary.temperature}</span>
        </div>
      )}
      <div className="lx-meta">
        <span>Gaps</span>
        {summary.gaps === null ? (
          <span>Gaps unavailable</span>
        ) : summary.gaps.length === 0 ? (
          <span>None found</span>
        ) : (
          <span>
            {summary.gaps.map((g) => (
              <span key={g} style={{ display: "block" }}>
                {g}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function Item({ item, tz }: { item: AnswerItem; tz: string }) {
  const finished = item.finishedAt !== null;
  const when = formatIntakeTime(item.at, tz);
  const state = finished ? "Finished" : "Didn't finish";
  if (item.kind === "request") {
    return (
      <details className="lx-disclosure-inline" data-kind="request">
        <summary>{`Intake questions sent to the client · ${when}`}</summary>
        <Answers pairs={item.pairs} finished />
      </details>
    );
  }
  const score = item.summary ? scoreLine(item.summary) : null;
  const head =
    item.kind === "submission"
      ? `${item.formName} · ${item.formKind === "assessment" ? "Assessment" : "Intake"} · ${when} · ${state}`
      : `Booth · ${item.eventCode} · ${when} · ${state}`;
  return (
    <details className="lx-disclosure-inline" data-kind={item.kind}>
      <summary>{score ? `${head} · ${score}` : head}</summary>
      <div style={{ display: "grid", gap: 10 }}>
        {item.kind === "booth" && (
          <div className="lx-meta">
            <span>Event · track</span>
            <span>{`${item.eventCode} · ${item.track === "brand" ? "Personal brand" : item.track === "business" ? "Business" : "Track not recorded"}`}</span>
          </div>
        )}
        {item.summary && <Result summary={item.summary} />}
        {!finished && (
          <p className="lx-note" style={{ margin: 0 }}>
            {item.kind === "booth"
              ? "They gave contact details at the booth and didn't finish the card."
              : "They gave contact details and didn't send answers."}
          </p>
        )}
        <Answers pairs={item.pairs} finished={finished} />
      </div>
    </details>
  );
}

export function AnswersCard({ read, tz = FIRM_TIME_ZONE }: { read: AnswersRead; tz?: string }) {
  const asked = SOURCES.map((s) => ({ ...s, read: read[s.key] as SourceRead })).filter((s) => s.read.status !== "skipped");
  const failed = asked.filter((s) => s.read.status === "unavailable");
  const missing = asked.filter((s) => s.read.status === "unconfigured");
  const capped = asked.filter((s) => s.read.status === "ok" && s.read.capped);
  const items = mergeAnswerItems(asked.flatMap((s) => (s.read.status === "ok" ? s.read.items : [])));
  const allEmpty = asked.length > 0 && asked.every((s) => s.read.status === "ok") && items.length === 0;

  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label={TITLE}>
      <div>
        <div className="lx-label">Staff only</div>
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          {TITLE}
        </h2>
      </div>
      {failed.length > 0 && (
        <div className="lx-banner lx-banner-warn" role="alert">
          {`Couldn't load answers: ${failed.map((s) => s.name).join(", ")}. This is a problem reaching the database, not an empty result. Try again shortly.`}
        </div>
      )}
      {missing.map((s) => (
        <p key={s.key} className="lx-note" style={{ margin: 0 }}>
          {`${s.name} aren't set up in this environment.`}
        </p>
      ))}
      {allEmpty && (
        <p className="lx-note" style={{ margin: 0 }}>
          {EMPTY_LINE}
        </p>
      )}
      {items.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <Item key={`${item.kind}:${item.id}`} item={item} tz={tz} />
          ))}
        </div>
      )}
      {capped.map((s) => (
        <p key={s.key} className="lx-note" style={{ margin: 0 }}>
          {`Showing the latest 200 ${s.name.toLowerCase()}.`}
        </p>
      ))}
    </section>
  );
}
