import type { Load } from "@/lib/intake-forms/load-results";
import { STEP_EVENT_LIMIT, STEP_PEOPLE_LIMIT, type StepFunnelRead } from "@/lib/intake-forms/load-steps";
import { formatDuration } from "@/lib/intake-forms/performance";
import { stoppedAtLabel, type StoppedAt } from "@/lib/intake-forms/step-funnel";

/**
 * Step-level numbers (Sprint 10): the drop-off table (Results), the median time
 * per step (Performance) and the "stopped at" readings (the All intakes table
 * and the drawer). Presentational: the numbers come from one aggregation
 * (`stepFunnel` in step-funnel.ts), so the tabs cannot disagree.
 *
 * Three states, always said: step data that isn't recorded yet (0096 isn't in
 * this database, or nobody has answered a question since), and data that
 * couldn't be loaded, are two different sentences, and neither is ever drawn as
 * zero or as "no drop-off".
 */

export function StepNotice({ state, range, what = "Step data" }: { state: Load<StepFunnelRead>; range: number; what?: string }) {
  if (state.status === "unconfigured") {
    return (
      <div className="lx-banner lx-banner-warn" role="status">
        {`${what} isn't recorded yet for this intake. It needs lectual migration 0096. Nothing is broken; the numbers appear once it is applied and people answer.`}
      </div>
    );
  }
  if (state.status === "unavailable") {
    return (
      <div className="lx-banner lx-banner-warn" role="status">
        {`Couldn't load ${what.toLowerCase()}. This is a problem reaching the database, not an empty result. Try again shortly.`}
      </div>
    );
  }
  if (!state.value.recorded) {
    return <p className="ifm-help">{`${what} isn't recorded yet for this intake in the last ${range} days. It fills in as people answer the questions.`}</p>;
  }
  return null;
}

function cappedLine(read: StepFunnelRead): string | null {
  return read.capped ? `Numbers cover the first ${STEP_EVENT_LIMIT.toLocaleString("en-US")} step events and ${STEP_PEOPLE_LIMIT.toLocaleString("en-US")} people in this range.` : null;
}

/** Reached, answered, went on and drop-off for each question, in the order people are asked. */
export function StepDropOff({ state, range }: { state: Load<StepFunnelRead>; range: number }) {
  const ok = state.status === "ok" && state.value.recorded ? state.value : null;
  return (
    <section className="ifm-card ifr-steps" aria-label="Drop-off by question">
      <div className="ifr-q-head">
        <h3 className="ifm-title">Drop-off by question</h3>
        <span className="ifm-help">{`Last ${range} days`}</span>
      </div>
      <StepNotice state={state} range={range} />
      {ok && (
        <div style={{ overflowX: "auto" }}>
          <table className="lx-tbl ifm-tbl">
            <thead>
              <tr>
                <th>Question</th>
                <th>Reached</th>
                <th>Answered</th>
                <th>Went on</th>
                <th>Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {ok.rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="pri">
                    {`Q${i + 1}. ${r.question}`}
                    {!r.inForm && <div className="ifm-help">No longer asked</div>}
                  </td>
                  <td>{r.reached.toLocaleString("en-US")}</td>
                  <td>{r.answered.toLocaleString("en-US")}</td>
                  <td>{r.wentOn.toLocaleString("en-US")}</td>
                  <td>{r.reached === 0 ? "—" : `${r.dropOff.toLocaleString("en-US")} · ${r.dropOffPct}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ok && (
        <p className="ifm-help">
          {`${ok.people.toLocaleString("en-US")} ${ok.people === 1 ? "person" : "people"} reached at least one question. "Went on" counts people who reached a later question or finished.`}
          {cappedLine(ok) ? ` ${cappedLine(ok)}` : ""}
        </p>
      )}
    </section>
  );
}

/** The median time people spend on each question. */
export function StepMedians({ state, range }: { state: Load<StepFunnelRead>; range: number }) {
  const ok = state.status === "ok" && state.value.recorded ? state.value : null;
  return (
    <section className="ifm-card ifm-steps" aria-label="Median time per step">
      <div className="ifr-q-head">
        <h3 className="ifm-title">Median time per step</h3>
        <span className="ifm-help">{`Last ${range} days`}</span>
      </div>
      <StepNotice state={state} range={range} />
      {ok && (
        <div style={{ overflowX: "auto" }}>
          <table className="lx-tbl ifm-tbl">
            <thead>
              <tr>
                <th>Question</th>
                <th>Median time on the question</th>
                <th>People</th>
              </tr>
            </thead>
            <tbody>
              {ok.rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="pri">{`Q${i + 1}. ${r.question}`}</td>
                  <td>{formatDuration(r.medianMs)}</td>
                  <td>{r.reached.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ok && (
        <p className="ifm-help">
          {"From reaching a question to reaching the next, or to finishing for the last one. People who left don't count toward the question they left on."}
          {cappedLine(ok) ? ` ${cappedLine(ok)}` : ""}
        </p>
      )}
    </section>
  );
}

/** The "Stopped at" cell: nothing to say for someone who finished. */
export function StoppedAtCell({ reading, state }: { reading: StoppedAt | undefined; state: "ok" | "unconfigured" | "unavailable" }) {
  // Someone who finished has no stopping point, whatever state the step read is in.
  if (reading?.kind === "finished") return <td className="ifm-stopped ifm-muted">—</td>;
  if (state === "unavailable") return <td className="ifm-stopped ifm-muted">Couldn&apos;t load</td>;
  if (state === "unconfigured") return <td className="ifm-stopped ifm-muted">not recorded</td>;
  const label = reading ? stoppedAtLabel(reading) : null;
  return <td className="ifm-stopped ifm-muted">{label ?? "—"}</td>;
}
