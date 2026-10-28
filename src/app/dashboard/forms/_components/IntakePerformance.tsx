import Link from "next/link";
import { RANGES, formatDuration, intakeTableRows, submissionStats, timingSplit, type RangeDays } from "@/lib/intake-forms/performance";
import { INTAKE_TABLE_LIMIT, loadFunnel, loadIntakeList, loadIntakeSubmission, loadSubmissionStatRows } from "@/lib/intake-forms/load-performance";
import { loadDrawerSteps, loadStepFunnel, loadStoppedAt } from "@/lib/intake-forms/load-steps";
import { formQuestions } from "@/lib/intake-forms/form-questions";
import type { StoppedAt } from "@/lib/intake-forms/step-funnel";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { getFirmTimeZone } from "@/lib/org/profile";
import { IntakeDrawer, Unreadable, FIT_TONE, STATUS_TONE } from "./IntakeDrawer";
import { StepMedians, StoppedAtCell } from "./StepTables";

/**
 * The Performance tab (server-rendered, handed to the workspace as a slot).
 *
 * Every read is three-state. The funnel and the table fail independently, and
 * each says so in its own place: a table that couldn't load is not "No
 * intakes yet", and a funnel that couldn't load is not a row of zeros.
 */

function hrefFor(formId: string, range: RangeDays, intake?: string) {
  return `/dashboard/forms/?form=${encodeURIComponent(formId)}&tab=performance&range=${range}${intake ? `&intake=${encodeURIComponent(intake)}` : ""}`;
}

export async function IntakePerformance({
  form,
  range,
  intakeId,
  canChangeStatus,
}: {
  form: IntakeFormRecord;
  range: RangeDays;
  intakeId: string | null;
  canChangeStatus: boolean;
}) {
  const [funnel, list, detail, tz, statRows, steps] = await Promise.all([
    loadFunnel(form.id, range),
    loadIntakeList(form.id),
    intakeId ? loadIntakeSubmission(intakeId) : Promise.resolve(null),
    getFirmTimeZone(),
    loadSubmissionStatRows(form.id, range),
    loadStepFunnel(form.id, range, formQuestions(form.kind, form.config)),
  ]);
  // Where unfinished people stopped: their own step events, read after the list (it names who is shown).
  const stopped =
    list.status === "ok"
      ? await loadStoppedAt(
          form.id,
          // A row from before 0093 carries no `submitted_at`: it was only ever written finished.
          list.value.map((r) => ({ id: r.id, started_at: r.started_at, submitted_at: r.submitted_at === null ? null : (r.submitted_at ?? r.started_at) })),
        )
      : null;
  const drawerSteps = await drawerStepsFor(form.id, detail);
  const stats = statRows.status === "ok" ? submissionStats(statRows.value.rows) : null;
  const split = statRows.status === "ok" ? timingSplit(statRows.value.rows) : null;

  const nothingYet = !form.everSaved && funnel.status === "ok" && funnel.value.visited === 0 && list.status === "ok" && list.value.length === 0;
  const rows = list.status === "ok" ? intakeTableRows(list.value, undefined, tz) : [];

  return (
    <div className="ifm-perf">
      <div className="ifm-perf-head">
        <h2 className="ifm-title" style={{ flex: 1 }}>
          Performance
        </h2>
        <nav className="ifm-seg" aria-label="Date range">
          {RANGES.map((r) => (
            <Link key={r} href={hrefFor(form.id, r)} scroll={false} className={range === r ? "on" : ""} aria-current={range === r ? "page" : undefined}>
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      {nothingYet ? (
        <div className="ifm-perf-empty">Tracking starts after your first save.</div>
      ) : (
        <>
          {funnel.status === "ok" ? (
            <div className="ifm-funnel-wrap">
              <div className="ifm-funnel">
                {[
                  { label: "Visited", value: funnel.value.visited, sub: "Unique visitors to the intake", conv: null },
                  {
                    label: "Started",
                    value: funnel.value.started,
                    sub: `${funnel.value.chat.toLocaleString("en-US")} chat · ${funnel.value.form.toLocaleString("en-US")} form`,
                    conv: funnel.value.startRate,
                  },
                  { label: "Completed", value: funnel.value.completed, sub: "Submitted with contact details", conv: funnel.value.completeRate },
                ].map((k) => (
                  <div key={k.label} className="ifm-kpi-step">
                    {k.conv !== null && (
                      <div className="ifm-kpi-arrow" aria-label={`Conversion ${k.conv}`}>
                        <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M1 7h23M18 1l6 6-6 6" />
                        </svg>
                        <span>{k.conv}</span>
                      </div>
                    )}
                    <div className="ifm-card ifm-kpi">
                      <div className="ifm-field-label">{k.label}</div>
                      <div className="ifm-kpi-value">{k.value.toLocaleString("en-US")}</div>
                      <div className="ifm-help">{k.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="ifm-help">
                Visits are estimated anonymously. No identities stored.
                {funnel.value.capped && " Counts cover the first 50,000 events in this range."}
              </p>
            </div>
          ) : (
            <Unreadable what="Visit and start counts" unconfigured={funnel.status === "unconfigured"} />
          )}

          {stats ? (
            <div className="ifm-stats" role="group" aria-label="People who started this intake">
              {[
                { label: "Gave contact details", value: stats.captured.toLocaleString("en-US"), sub: "Asked first, before any question" },
                { label: "Finished", value: stats.completed.toLocaleString("en-US"), sub: `${stats.completionRate} of those` },
                { label: "Didn't finish", value: stats.unfinished.toLocaleString("en-US"), sub: "Still leads: worth a follow-up" },
                { label: "Typical time (median)", value: formatDuration(stats.medianMs), sub: "From opening the page to sending" },
                {
                  label: "Page to contact details",
                  value: formatDuration(split?.medianToContactMs ?? null),
                  sub: "Median, from opening the page to giving details",
                },
                {
                  label: "Contact details to finish",
                  value: formatDuration(split?.medianContactToFinishMs ?? null),
                  sub: "Median, over people who finished",
                },
                ...(form.kind === "assessment"
                  ? [
                      {
                        label: "Hot · warm · cold",
                        value: `${stats.temperatures.hot} · ${stats.temperatures.warm} · ${stats.temperatures.cold}`,
                        sub: "Of those who finished. Only your firm sees this",
                      },
                    ]
                  : []),
              ].map((k) => (
                <div key={k.label} className="ifm-card ifm-kpi">
                  <div className="ifm-field-label">{k.label}</div>
                  <div className="ifm-kpi-value">{k.value}</div>
                  <div className="ifm-help">{k.sub}</div>
                </div>
              ))}
            </div>
          ) : (
            <Unreadable what="Completion numbers" unconfigured={statRows.status === "unconfigured"} />
          )}
          {statRows.status === "ok" && statRows.value.capped && (
            <p className="ifm-help">Numbers cover the latest 5,000 people in this range.</p>
          )}

          <StepMedians state={steps} range={range} />

          <div className="ifm-card ifm-table-card">
            <h2 className="ifm-title ifm-table-title">All intakes</h2>
            {list.status !== "ok" ? (
              <div style={{ padding: "0 24px 20px" }}>
                <Unreadable what="Intakes" unconfigured={list.status === "unconfigured"} />
              </div>
            ) : rows.length === 0 ? (
              <p className="ifm-help" style={{ padding: "0 24px 22px", margin: 0 }}>
                No intakes yet. They appear here as soon as someone starts your intake.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="lx-tbl ifm-tbl">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Started</th>
                      <th>Mode</th>
                      <th>{form.kind === "assessment" ? "Heat · score" : "Fit"}</th>
                      <th>Status</th>
                      <th>Last active</th>
                      <th>Stopped at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={intakeId === r.id ? "sel" : undefined}>
                        <td className="pri">
                          <Link href={hrefFor(form.id, range, r.id)} scroll={false} className="lx-rowlink">
                            {r.name}
                          </Link>
                          <div className="ifm-help">{r.company}</div>
                        </td>
                        <td>{r.started}</td>
                        <td>
                          {r.mode}
                          {!r.finished && <span className="lx-pill lx-pill-warn ifm-unfinished">Didn&apos;t finish</span>}
                        </td>
                        <td>
                          <span className={`ifm-badge ${FIT_TONE[r.fitKey] ?? "mute"}`}>{r.fit}</span>
                        </td>
                        <td>
                          <span className={`ifm-badge ${STATUS_TONE[r.statusKey] ?? "mute"}`}>{r.status}</span>
                        </td>
                        <td className="ifm-muted">{r.last}</td>
                        <StoppedAtCell
                          state={stopped === null ? "unavailable" : stopped.status === "ok" ? "ok" : stopped.status}
                          reading={stoppedReading(stopped, r.id, r.finished)}
                        />
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length >= INTAKE_TABLE_LIMIT && (
                  <p className="ifm-help" style={{ padding: "10px 24px 16px", margin: 0 }}>
                    Showing the latest {INTAKE_TABLE_LIMIT}.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {intakeId && detail && <IntakeDrawer detail={detail} tz={tz} closeHref={hrefFor(form.id, range)} canChangeStatus={canChangeStatus} steps={drawerSteps} stepQuestions={questionTexts(form)} />}
    </div>
  );
}

/** One row's reading; a person the read didn't cover is "not recorded", never a blank. */
function stoppedReading(read: Awaited<ReturnType<typeof loadStoppedAt>> | null, id: string, finished: boolean): StoppedAt | undefined {
  if (finished) return { kind: "finished" };
  if (!read || read.status !== "ok") return undefined;
  return read.value[id] ?? { kind: "not_recorded" };
}

/** The drawer's step reading, read only for someone who hasn't finished (a finished person has nothing to add). */
export async function drawerStepsFor(formId: string, detail: Awaited<ReturnType<typeof loadIntakeSubmission>> | null) {
  if (!detail || detail.status !== "ok" || !detail.value || detail.value.submitted_at) return null;
  return loadDrawerSteps(formId, detail.value);
}

/** Question text by id, for labelling a person's saved answers. */
export function questionTexts(form: IntakeFormRecord): Record<string, string> {
  return Object.fromEntries(formQuestions(form.kind, form.config).map((q) => [q.id, q.text]));
}
