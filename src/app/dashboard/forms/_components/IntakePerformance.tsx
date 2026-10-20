import Link from "next/link";
import { RANGES, formatDuration, intakeDetail, intakeTableRows, submissionStats, type RangeDays } from "@/lib/intake-forms/performance";
import { INTAKE_TABLE_LIMIT, loadFunnel, loadIntakeList, loadIntakeSubmission, loadSubmissionStatRows } from "@/lib/intake-forms/load-performance";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { getFirmTimeZone } from "@/lib/org/profile";
import { IntakeStatusForm } from "./IntakeStatusForm";

/**
 * The Performance tab (server-rendered, handed to the workspace as a slot).
 *
 * Every read is three-state. The funnel and the table fail independently, and
 * each says so in its own place: a table that couldn't load is not "No
 * intakes yet", and a funnel that couldn't load is not a row of zeros.
 */

const FIT_TONE: Record<string, string> = { fit: "ok", non_fit: "risk", unscored: "mute", hot: "risk", warm: "warn", cold: "mute" };
const STATUS_TONE: Record<string, string> = {
  new: "ox",
  referred: "sand",
  consult_booked: "warn",
  engaged: "ok",
  rejected: "risk",
  stopped: "mute",
};

function hrefFor(formId: string, range: RangeDays, intake?: string) {
  return `/dashboard/forms/?form=${encodeURIComponent(formId)}&tab=performance&range=${range}${intake ? `&intake=${encodeURIComponent(intake)}` : ""}`;
}

function Unreadable({ what, unconfigured }: { what: string; unconfigured: boolean }) {
  return (
    <div className="lx-banner lx-banner-warn" role="status">
      {unconfigured
        ? `${what} aren't set up in this environment (lectual migration 0079). Nothing is broken; it needs the migration.`
        : `${what} couldn't be loaded. This is a problem reaching the database, not an empty result. Try again shortly.`}
    </div>
  );
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
  const [funnel, list, detail, tz, statRows] = await Promise.all([
    loadFunnel(form.id, range),
    loadIntakeList(form.id),
    intakeId ? loadIntakeSubmission(intakeId) : Promise.resolve(null),
    getFirmTimeZone(),
    loadSubmissionStatRows(form.id, range),
  ]);
  const stats = statRows.status === "ok" ? submissionStats(statRows.value.rows) : null;

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
                { label: "Median time to finish", value: formatDuration(stats.medianMs), sub: "From opening the page to sending" },
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

      {intakeId && detail && <IntakeDrawer detail={detail} tz={tz} closeHref={hrefFor(form.id, range)} canChangeStatus={canChangeStatus} />}
    </div>
  );
}

function IntakeDrawer({
  tz,
  detail,
  closeHref,
  canChangeStatus,
}: {
  detail: Awaited<ReturnType<typeof loadIntakeSubmission>>;
  tz: string;
  closeHref: string;
  canChangeStatus: boolean;
}) {
  const d = detail.status === "ok" && detail.value ? intakeDetail(detail.value, tz) : null;
  return (
    <div className="ifm-drawer-wrap">
      <Link href={closeHref} scroll={false} className="ifm-drawer-scrim" aria-label="Close" />
      <aside className="ifm-drawer" aria-label="Intake">
        <div className="ifm-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ifm-drawer-name">{d ? d.name : "Intake"}</div>
            {d?.sub && <div className="ifm-help">{d.sub}</div>}
          </div>
          <Link href={closeHref} scroll={false} className="ifm-icon-btn" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>
        <div className="ifm-drawer-body">
          {detail.status !== "ok" ? (
            <Unreadable what="This intake" unconfigured={detail.status === "unconfigured"} />
          ) : !d ? (
            <p className="ifm-help">That intake isn&apos;t in your firm, or it was removed.</p>
          ) : (
            <>
              <div className="ifm-drawer-badges">
                <span className={`ifm-badge ${FIT_TONE[d.fitKey] ?? "mute"}`}>{d.fit}</span>
                <span className={`ifm-badge ${STATUS_TONE[d.statusKey] ?? "mute"}`}>{d.status}</span>
                <span className="ifm-badge sand">{d.modeLine}</span>
              </div>
              <div className="ifm-note">
                <div className="ifm-caps">Screening note</div>
                <div>{d.why}</div>
              </div>
              {canChangeStatus && <IntakeStatusForm key={`${d.id}:${d.statusKey}`} id={d.id} status={d.statusKey} />}
              <dl className="ifm-answers">
                {d.answers.map((a, i) => (
                  <div key={i}>
                    <dt>{a.q}</dt>
                    <dd>{a.a}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
