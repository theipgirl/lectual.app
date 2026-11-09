import Link from "next/link";
import { BUCKET_COPY, bucketOf, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import { BOARD_COLUMNS, laneOf, type Kpis, type Lane, type MeetingPosition, type StageGroup } from "@/lib/review/lanes";
import { dueText, lastContactText } from "@/lib/review/format";
import { openToken } from "@/lib/review/open";
import { reviewHref, REVIEW_VIEWS, type ReviewParams, type ReviewView } from "@/lib/review/params";
import { REVIEW_AGENDA_VIEW, REVIEW_CARDS_VIEW } from "@/lib/ui/words";
import type { AgendaGroup } from "@/lib/review/agenda";
import { WAITING_LABEL } from "@/lib/review/waiting";
import { DoneButton } from "./DoneButton";
import { Avatar, openHref, Tags, type Common } from "./shared";
import { ReviewTable } from "./ReviewSection";
import "@/components/list-page/list-page.css";
import "./review.css";

const VIEW_LABEL: Record<ReviewView, string> = { agenda: REVIEW_AGENDA_VIEW, board: "Board", meeting: "Meeting mode", stage: "By stage", cards: REVIEW_CARDS_VIEW };

/** The three views, as links (the URL carries the view), in the design's segmented control. */
export function ViewSwitch({ params }: { params: ReviewParams }) {
  return (
    <nav className="lx-segs lx-view-toggle" aria-label="View">
      {REVIEW_VIEWS.map((v) => (
        <Link key={v} href={reviewHref({ ...params, view: v, i: 1, open: null })} aria-current={params.view === v ? "page" : undefined} className={params.view === v ? "on" : undefined}>
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
      <Tile label="Proposals expiring this week" value={kpis.expiring} tone="warn" />
    </div>
  );
}

/** The whole card is one link to the panel; Done and Open sit OUTSIDE it, so nothing interactive is nested. */
export function Card({ row, bucket, today, members, canWrite, params, showOwner }: Common & { row: ReviewRow; bucket: BucketKey; /** The agenda names who owns the next step on the card itself, since the meeting assigns by person. */ showOwner?: boolean }) {
  const due = row.nextStep ? dueText(row.nextStep.dueDate, today) : null;
  const ownerId = laneOf(row);
  const ownerName = ownerId ? members.find((m) => m.userId === ownerId)?.name ?? "Teammate" : null;
  const href = openHref(params, row);
  return (
    <article className={`lx-card rv-card rv-card-${bucket}`} data-key={openToken(row)}>
      <Link href={href} className="rv-card-link" scroll={false}>
        <span className="rv-card-top">
          <span className="rv-card-title">{row.client}</span>
          {ownerName && <Avatar name={ownerName} />}
        </span>
        <span className="rv-card-meta lx-note">
          {row.kind === "lead" ? "Lead" : "Matter"}
          {row.mark ? ` · ${row.mark}` : ""}
          {row.stageLabel ? ` · ${row.stageLabel}` : ""}
        </span>
        <span className="rv-card-step">
          {row.nextStep ? row.nextStep.title : "No next step"}
          {due && <span className={`rv-chip${due.overdue ? " rv-chip-overdue" : ""}`}>{due.text}</span>}
        </span>
        {showOwner && (
          <span className="rv-card-owner">
            <span className="lx-label">Next step</span> {ownerName ?? "Unassigned"}
          </span>
        )}
        <Tags row={row} today={today} max={2} />
      </Link>
      <div className="rv-card-acts">
        {canWrite && row.nextStep && <DoneButton taskId={row.nextStep.id} />}
        <Link href={href} className="lx-btn lx-btn-ghost lx-btn-sm" scroll={false}>
          Open
        </Link>
      </div>
    </article>
  );
}

/**
 * The Monday agenda: the meeting's five sections in order, each with a count. Cards are the board's own `Card`
 * (a link to the panel, no forms), with the next step's owner named. Parked is collapsed.
 */
export function AgendaView({ groups, ...common }: Common & { groups: AgendaGroup[] }) {
  return (
    <div className="rv-agenda">
      {groups.map((g, n) => {
        const body =
          g.rows.length === 0 ? (
            <p className="lx-note rv-agenda-empty">Nothing here this week.</p>
          ) : (
            <div className="rv-agenda-cards">
              {g.rows.map((row) => (
                <Card key={row.key} row={row} bucket={bucketOf(row, common.today)} showOwner {...common} />
              ))}
            </div>
          );
        const head = (
          <>
            <span className="lx-h2 rv-agenda-title">{n + 1}. {g.label}</span>{" "}
            <span className="lx-note">{g.rows.length}</span>
          </>
        );
        return g.section === "parked" ? (
          <details key={g.section} className="lx-card rv-agenda-sec rv-agenda-parked" data-section={g.section}>
            <summary className="rv-agenda-head">{head}</summary>
            <p className="lx-note rv-agenda-hint">{g.hint}</p>
            {body}
          </details>
        ) : (
          <section key={g.section} className="lx-card rv-agenda-sec" data-section={g.section} aria-labelledby={`rv-agenda-${g.section}`}>
            <h2 id={`rv-agenda-${g.section}`} className="rv-agenda-head">{head}</h2>
            <p className="lx-note rv-agenda-hint">{g.hint}</p>
            {body}
          </section>
        );
      })}
    </div>
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
            <Avatar name={lane.name} />
            <span>{lane.name}</span> <span className="lx-note">{lane.count}</span>
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
  sectionLabel,
  ...common
}: Common & { row: ReviewRow | null; bucket: BucketKey | null; pos: MeetingPosition | null; /** The agenda section the row is in, e.g. "USPTO matters". */ sectionLabel?: string | null }) {
  if (!row || !pos) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing left to go through</h2>
        <p className="lx-note" style={{ margin: 0 }}>Nothing in the four meeting sections for this view. Parked records are left out.</p>
      </div>
    );
  }
  const href = (i: number) => reviewHref({ ...params, view: "meeting", i, open: null });
  const due = row.nextStep ? dueText(row.nextStep.dueDate, common.today) : null;
  const who = (id: string | null) => (id ? common.members.find((m) => m.userId === id)?.name ?? "Teammate" : null);
  const owner = who(row.nextStep?.assigneeId ?? null) ?? who(row.assignedTo);
  return (
    <div className="lx-card rv-focus">
      <p className="lx-note rv-prog" role="status">
        {pos.position} of {pos.total}
        {sectionLabel ? ` · ${sectionLabel}` : ""}
        {bucket ? ` · ${BUCKET_COPY[bucket].label}` : ""}
      </p>
      <h2 className="lx-h2">
        <Link href={openHref(params, row)} scroll={false}>
          {row.client}
        </Link>
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
      <div className="rv-card-acts">
        {common.canWrite && row.nextStep && <DoneButton taskId={row.nextStep.id} />}
        <Link href={openHref(params, row)} className="lx-btn lx-btn-sec lx-btn-sm" scroll={false}>
          Open details
        </Link>
      </div>
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
