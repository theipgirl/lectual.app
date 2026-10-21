import Link from "next/link";
import { RANGES, formatIntakeTime, type RangeDays } from "@/lib/intake-forms/performance";
import { loadIntakeSubmission } from "@/lib/intake-forms/load-performance";
import { RESULT_ROW_LIMIT, loadResultSubmissions } from "@/lib/intake-forms/load-results";
import { assessmentResults, extraQuestionResults, intakeQuestionResults, ANSWERS_PER_QUESTION, type QuestionResult } from "@/lib/intake-forms/results";
import { loadStepFunnel } from "@/lib/intake-forms/load-steps";
import { sampleFromSubmission } from "@/lib/intake-forms/assessment-samples";
import { assessmentExtras, assessmentQuestions } from "@/lib/intake-forms/assessment";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { formQuestions } from "@/lib/intake-forms/form-questions";
import { getFirmTimeZone } from "@/lib/org/profile";
import { AssessmentBlocks } from "./AssessmentBlocks";
import { IntakeDrawer, Unreadable } from "./IntakeDrawer";
import { drawerStepsFor, questionTexts } from "./IntakePerformance";
import { StepDropOff } from "./StepTables";

/**
 * The Results tab (server-rendered, handed to the workspace as a slot, as
 * Performance is). Per question for an intake, distributions for an
 * assessment, over the people who started it in the range.
 *
 * The read is three-state: a result that couldn't be loaded says so and is
 * never drawn as "no answers yet". A row opens the same person drawer as
 * Performance, at `tab=results&intake=<id>`, so closing it returns here.
 */

export function resultsHref(formId: string, range: RangeDays, intake?: string) {
  return `/dashboard/forms/?form=${encodeURIComponent(formId)}&tab=results&range=${range}${intake ? `&intake=${encodeURIComponent(intake)}` : ""}`;
}

export function exportHref(formId: string, range: RangeDays) {
  return `/dashboard/forms/export/?form=${encodeURIComponent(formId)}&range=${range}`;
}

/** The lead of the person whose drawer is open, from the rows already read. */
function leadHrefFor(read: Awaited<ReturnType<typeof loadResultSubmissions>>, intakeId: string): string | null {
  if (read.status !== "ok") return null;
  const leadId = read.value.rows.find((r) => r.id === intakeId)?.lead_id;
  return leadId ? `/dashboard/leads/${encodeURIComponent(leadId)}/` : null;
}

export async function IntakeResults({
  form,
  range,
  intakeId,
  canChangeStatus,
  canExport,
}: {
  form: IntakeFormRecord;
  range: RangeDays;
  intakeId: string | null;
  canChangeStatus: boolean;
  canExport: boolean;
}) {
  const [read, detail, tz, steps] = await Promise.all([
    loadResultSubmissions(form.id, range),
    intakeId ? loadIntakeSubmission(intakeId) : Promise.resolve(null),
    getFirmTimeZone(),
    loadStepFunnel(form.id, range, formQuestions(form.kind, form.config)),
  ]);
  const drawerSteps = await drawerStepsFor(form.id, detail);

  return (
    <div className="ifm-perf">
      <div className="ifm-perf-head">
        <h2 className="ifm-title" style={{ flex: 1 }}>
          Results
        </h2>
        {canExport ? (
          <a className="lx-btn lx-btn-sec" href={exportHref(form.id, range)} download>
            Export CSV
          </a>
        ) : (
          <span className="ifm-help">CSV export is for staff roles.</span>
        )}
        <nav className="ifm-seg" aria-label="Date range">
          {RANGES.map((r) => (
            <Link key={r} href={resultsHref(form.id, r)} scroll={false} className={range === r ? "on" : ""} aria-current={range === r ? "page" : undefined}>
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      {read.status !== "ok" ? (
        <Unreadable what="Results" unconfigured={read.status === "unconfigured"} />
      ) : form.kind === "assessment" ? (
        <>
          <AssessmentBlocks
            results={assessmentResults(
              read.value.rows.map((r) => sampleFromSubmission(r)),
              assessmentQuestions(form.config.assessment, "business"),
            )}
            who={`in the last ${range} days`}
          />
          <ExtraAnswers
            form={form}
            range={range}
            intakeId={intakeId}
            tz={tz}
            results={extraQuestionResults(
              read.value.rows,
              assessmentExtras(form.config.assessment).map((e) => ({ id: e.id, text: e.text })),
            )}
          />
        </>
      ) : (
        <PerQuestion form={form} range={range} intakeId={intakeId} tz={tz} rows={read.value.rows} />
      )}
      <StepDropOff state={steps} range={range} />
      {read.status === "ok" && read.value.capped && <p className="ifm-help">{`Results cover the latest ${RESULT_ROW_LIMIT.toLocaleString("en-US")} people in this range.`}</p>}

      {intakeId && detail && (
        <IntakeDrawer
          detail={detail}
          tz={tz}
          closeHref={resultsHref(form.id, range)}
          canChangeStatus={canChangeStatus}
          leadHref={leadHrefFor(read, intakeId)}
          steps={drawerSteps}
          stepQuestions={questionTexts(form)}
        />
      )}
    </div>
  );
}

function PerQuestion({
  form,
  range,
  intakeId,
  tz,
  rows,
}: {
  form: IntakeFormRecord;
  range: RangeDays;
  intakeId: string | null;
  tz: string;
  rows: Parameters<typeof intakeQuestionResults>[0];
}) {
  const questions = intakeQuestionResults(rows, formQuestions(form.kind, form.config));
  const sent = rows.filter((r) => r.submitted_at).length;
  const unfinished = rows.length - sent;
  if (questions.length === 0) {
    return (
      <div className="ifm-perf-empty">This intake has no questions yet. Add them in Form setup, and answers will be listed here.</div>
    );
  }
  return (
    <>
      <p className="ifm-help">
        {`${sent.toLocaleString("en-US")} ${sent === 1 ? "person" : "people"} sent answers in the last ${range} days.`}
        {unfinished > 0 ? ` ${unfinished.toLocaleString("en-US")} more gave contact details and didn't finish.` : ""}
      </p>
      <QuestionLists form={form} range={range} intakeId={intakeId} tz={tz} results={questions} />
    </>
  );
}

/** Each question's answers, newest first (who, when, answer, a link to the lead). */
function QuestionLists({
  form,
  range,
  intakeId,
  tz,
  results,
}: {
  form: IntakeFormRecord;
  range: RangeDays;
  intakeId: string | null;
  tz: string;
  results: QuestionResult[];
}) {
  return (
    <>
      {results.map((q) => (
        <section key={q.key} className="ifm-card ifr-q" aria-label={q.question}>
          <div className="ifr-q-head">
            <h3 className="ifm-title">{q.question}</h3>
            <span className="ifm-help">
              {`${q.total.toLocaleString("en-US")} ${q.total === 1 ? "answer" : "answers"}`}
              {q.inForm ? "" : " · no longer asked"}
            </span>
          </div>
          {q.rows.length === 0 ? (
            <p className="ifm-help">No answers to this question in this range.</p>
          ) : (
            <ul className="ifr-answers">
              {q.rows.map((a, i) => (
                <li key={`${a.submissionId}:${i}`} className={intakeId === a.submissionId ? "sel" : undefined}>
                  <span className="ifr-who">
                    <Link href={resultsHref(form.id, range, a.submissionId)} scroll={false} className="lx-rowlink">
                      {a.who}
                    </Link>
                  </span>
                  <span className="ifr-text">{a.answer}</span>
                  <span className="ifr-meta">
                    {formatIntakeTime(a.at, tz)}
                    {a.leadId && (
                      <>
                        {" · "}
                        <Link href={`/dashboard/leads/${encodeURIComponent(a.leadId)}/`}>Lead</Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {q.capped && <p className="ifm-help">{`Showing the latest ${ANSWERS_PER_QUESTION} of ${q.total.toLocaleString("en-US")}.`}</p>}
        </section>
      ))}
    </>
  );
}

/**
 * The firm's own assessment questions: an answer list per question beneath the
 * distributions. They are unscored, so they have no bars, only who said what.
 */
function ExtraAnswers({
  form,
  range,
  intakeId,
  tz,
  results,
}: {
  form: IntakeFormRecord;
  range: RangeDays;
  intakeId: string | null;
  tz: string;
  results: QuestionResult[];
}) {
  if (results.length === 0) return null;
  return (
    <div className="ifr-extras" aria-label="Your own questions">
      <h3 className="ifm-title">Your own questions</h3>
      <p className="ifm-help">Not scored: these answers never change the score or hot, warm or cold.</p>
      <QuestionLists form={form} range={range} intakeId={intakeId} tz={tz} results={results} />
    </div>
  );
}
