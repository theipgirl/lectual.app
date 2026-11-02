import Link from "next/link";
import { BUCKET_COPY, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import { BOARD_COLUMNS, type Kpis, type Lane, type MeetingPosition, type StageGroup } from "@/lib/review/lanes";
import { WAITING_LABEL } from "@/lib/review/waiting";
import { deadlineIsSoon, dueText, lastContactText, shortDate } from "@/lib/review/format";
import { reviewHref, REVIEW_VIEWS, type ReviewParams, type ReviewView } from "@/lib/review/params";
import { ReviewRowActions } from "./ReviewRowActions";
import { ReviewTable } from "./ReviewSection";
import "@/components/list-page/list-page.css";
import "./review.css";

type Member = { userId: string; name: string };
type Common = { today: string; members: Member[]; canWrite: boolean };

const VIEW_LABEL: Record<ReviewView, string> = { board: "Board", meeting: "Meeting mode", stage: "By stage" };

/** The three views, as links (the URL carries the view), in the design's segmented control. */
export function ViewSwitch({ params }: { params: ReviewParams }) {
  return (
    <nav className="lx-segs lx-view-toggle" aria-label="View">
      {REVIEW_VIEWS.map((v) => (
        <Link key={v} href={reviewHref({ ...params, view: v, i: 1 })} aria-current={params.view === v ? "page" : undefined} className={params.view === v ? "on" : undefined}>
          {VIEW_LABEL[v]}
        </Link>
      ))}
    </nav>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | null; tone?: "risk" | "warn" }) {
  return (
    <div className="lx-card lx-kpi">
      <span className="lx-label">{label}</span>
      <span className="lx-kpi-value" style={tone && value ? { color: tone === "risk" ? "var(--ox)" : "var(--warn)" } : undefined}>
        {value === null ? "—" : value}
      </span>
      {value === null && <span className="lx-note">Couldn&apos;t load</span>}
    </div>
  );
}

/** Overdue, due this week, waiting on approval, needs a next step, waiting on the USPTO. A failed source is a dash. */
export function KpiStrip({ kpis }: { kpis: Kpis }) {
  return (
    <div className="rv-kpis" role="group" aria-label="This week at a glance">
      <Tile label="Overdue" value={kpis.overdue} tone="risk" />
      <Tile label="Due this week" value={kpis.week} tone="warn" />
      <Tile label="Waiting on approval" value={kpis.approval} />
      <Tile label="Needs a next step" value={kpis.needs} />
      <Tile label="Waiting on the USPTO" value={kpis.uspto} />
    </div>
  );
}

function Tags({ row, today }: { row: ReviewRow; today: string }) {
  return (
    <div className="rv-tags">
      {row.waiting && <span className={`lp-pill${row.waiting === "approval" ? " lp-pill-warn" : ""}`}>Waiting on {WAITING_LABEL[row.waiting]}</span>}
      {row.deadline && (
        <span className={`lp-pill${deadlineIsSoon(row.deadline.dueDate, today) ? " lp-pill-risk" : ""}`}>USPTO deadline {shortDate(row.deadline.dueDate, today)}</span>
      )}
    </div>
  );
}

function Card({ row, bucket, today, members, canWrite }: Common & { row: ReviewRow; bucket: BucketKey }) {
  const due = row.nextStep ? dueText(row.nextStep.dueDate, today) : null;
  return (
    <article className={`lx-card rv-card rv-card-${bucket}`}>
      <Link href={row.href} className="rv-card-title">
        {row.client}
      </Link>
      <div className="lx-note">
        {row.kind === "lead" ? "Lead" : "Matter"}
        {row.mark ? ` · ${row.mark}` : ""}
        {row.stageLabel ? ` · ${row.stageLabel}` : ""}
      </div>
      <p className="rv-card-step">
        {row.nextStep ? row.nextStep.title : "No next step"}
        {due && <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>{due.text}</span>}
      </p>
      <Tags row={row} today={today} />
      {canWrite && <ReviewRowActions kind={row.kind} id={row.id} nextStepId={row.nextStep?.id ?? null} members={members} defaultAssignee={row.nextStep?.assigneeId ?? row.assignedTo} />}
    </article>
  );
}

/** People down the side, the four flagged groups across. Stacks (each lane a section) under 640px; scrolls sideways under 900px. */
export function ReviewBoard({ lanes, ...common }: Common & { lanes: Lane[] }) {
  if (lanes.length === 0) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing needs attention</h2>
        <p className="lx-note" style={{ margin: 0 }}>No overdue, due-this-week, undated or quiet records for this view.</p>
      </div>
    );
  }
  return (
    <div className="rv-board">
      {lanes.map((lane) => (
        <section key={lane.userId ?? "none"} className="rv-person" aria-labelledby={`rv-person-${lane.userId ?? "none"}`}>
          <h2 id={`rv-person-${lane.userId ?? "none"}`} className="lx-h2 rv-person-name">
            {lane.name} <span className="lx-note">{lane.count}</span>
          </h2>
          <div className="rv-scroll">
            <div className="rv-cols">
              {BOARD_COLUMNS.map((c) => (
                <div key={c} className="rv-col">
                  <h3 className="lx-label rv-colh">
                    {BUCKET_COPY[c].label} <span className="lx-note">{lane.columns[c].length}</span>
                  </h3>
                  {lane.columns[c].map((row) => (
                    <Card key={row.key} row={row} bucket={c} {...common} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** One record at a time. Prev / Next are links; "Keep" is just Next. */
export function MeetingCard({
  row,
  bucket,
  pos,
  params,
  ...common
}: Common & { row: ReviewRow | null; bucket: BucketKey | null; pos: MeetingPosition | null; params: ReviewParams }) {
  if (!row || !pos) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing left to go through</h2>
        <p className="lx-note" style={{ margin: 0 }}>Every record in this view has a dated next step and recent contact.</p>
      </div>
    );
  }
  const href = (i: number) => reviewHref({ ...params, view: "meeting", i });
  const due = row.nextStep ? dueText(row.nextStep.dueDate, common.today) : null;
  const who = (id: string | null) => (id ? common.members.find((m) => m.userId === id)?.name ?? "Teammate" : null);
  const owner = who(row.nextStep?.assigneeId ?? null) ?? who(row.assignedTo);
  return (
    <div className="lx-card rv-focus">
      <p className="lx-note rv-prog" role="status">
        {pos.position} of {pos.total}
        {bucket ? ` · ${BUCKET_COPY[bucket].label}` : ""}
      </p>
      <h2 className="lx-h2">
        <Link href={row.href}>{row.client}</Link>
      </h2>
      <div className="lx-note">
        {row.kind === "lead" ? "Lead" : "Matter"}
        {row.mark ? ` · ${row.mark}` : ""}
        {row.stageLabel ? ` · ${row.stageLabel}` : ""}
      </div>
      <dl className="rv-facts">
        <div>
          <dt className="lx-label">Last contact</dt>
          <dd>{lastContactText(row, common.today)}</dd>
        </div>
        <div>
          <dt className="lx-label">Next step</dt>
          <dd>
            {row.nextStep ? row.nextStep.title : "No next step"}
            {due && (
              <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>
                {due.text}
                {owner ? ` · ${owner}` : ""}
              </span>
            )}
            {!row.nextStep && owner && <span className="lx-note rv-sub">{owner}</span>}
          </dd>
        </div>
        <div>
          <dt className="lx-label">Waiting on</dt>
          <dd>{row.waiting ? WAITING_LABEL[row.waiting] : "—"}</dd>
        </div>
        <div>
          <dt className="lx-label">In stage</dt>
          <dd>{row.stageDays !== null ? `${row.stageDays} days` : row.stageNote ?? "—"}</dd>
        </div>
      </dl>
      <Tags row={row} today={common.today} />
      {common.canWrite && <ReviewRowActions kind={row.kind} id={row.id} nextStepId={row.nextStep?.id ?? null} members={common.members} defaultAssignee={row.nextStep?.assigneeId ?? row.assignedTo} />}
      <nav className="rv-pager" aria-label="Meeting mode">
        {pos.prev ? <Link className="lx-btn lx-btn-ghost lx-btn-sm" href={href(pos.prev)}>Previous</Link> : <span />}
        {pos.next ? <Link className="lx-btn lx-btn-sec lx-btn-sm" href={href(pos.next)}>Keep and go to next</Link> : <span className="lx-note">That&apos;s the last one.</span>}
      </nav>
    </div>
  );
}

/** Rows grouped by stage in pipeline order, flagged rows first, with counts. */
export function StageView({ groups, ...common }: Common & { groups: StageGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing to show</h2>
        <p className="lx-note" style={{ margin: 0 }}>Try another filter or search.</p>
      </div>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="lx-card lx-band" aria-labelledby={`rv-stage-${g.key}`}>
          <header className="lx-band-head">
            <h2 id={`rv-stage-${g.key}`} className="lx-h2">{g.label}</h2>
            <span className="lx-note">
              {g.rows.length} {g.kind === "lead" ? (g.rows.length === 1 ? "lead" : "leads") : g.rows.length === 1 ? "matter" : "matters"}
              {g.flagged > 0 ? ` · ${g.flagged} need attention` : ""}
            </span>
          </header>
          <ReviewTable rows={g.rows} {...common} />
        </section>
      ))}
    </>
  );
}
