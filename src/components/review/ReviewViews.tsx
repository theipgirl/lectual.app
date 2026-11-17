import Link from "next/link";
import { bucketOf, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import { laneLabel, laneLoad, laneLoadText, type Kpis, type Lane } from "@/lib/review/lanes";
import { cardSubline, dueText, sentText } from "@/lib/review/format";
import { openToken } from "@/lib/review/open";
import { reviewHref, REVIEW_VIEWS, type ReviewParams, type ReviewView } from "@/lib/review/params";
import { NOTHING_WAITING_ON_YOU, OUR_TURN, WAITING_ON_YOU, WAITING_ON_YOU_PARTIAL, REVIEW_BOARD_VIEW, REVIEW_CARDS_VIEW, REVIEW_SHEET_VIEW } from "@/lib/ui/words";
import { DoneButton } from "./DoneButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import type { PillTone } from "@/lib/ui/tones";
import { BoardCard, BoardColumn } from "@/components/ui/Board";
import { DocTag, openHref, Tags, type Common } from "./shared";
import "@/components/list-page/list-page.css";
import "./review.css";
import { ViewToggle } from "@/components/ViewToggle";

const VIEW_LABEL: Record<ReviewView, string> = { board: REVIEW_BOARD_VIEW, sheet: REVIEW_SHEET_VIEW, cards: REVIEW_CARDS_VIEW };

/** The three views, as links (the URL carries the view), in the app's one view switch. */
export function ViewSwitch({ params }: { params: ReviewParams }) {
  return (
    <ViewToggle<ReviewView>
      value={params.view}
      views={REVIEW_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
      hrefFor={(v) => reviewHref({ ...params, view: v, i: 1, open: null })}
    />
  );
}

function Tile({ label, value, tone }: { label: string; value: number | null; tone?: "risk" | "warn" }) {
  return (
    <div className="lx-card lx-kpi rv-kpi" data-tone={value ? tone : undefined}>
      <span className="lx-label">{label}</span>
      <span className="lx-kpi-value">{value === null ? "—" : value}</span>
      {value === null && <span className="lx-note">Couldn&apos;t load</span>}
    </div>
  );
}

/** Overdue, due this week, needs a next step, waiting on the USPTO. (Approvals and proposals have their own strips.) */
export function KpiStrip({ kpis }: { kpis: Kpis; owner?: boolean }) {
  return (
    <div className="rv-kpis" role="group" aria-label="This week at a glance">
      <Tile label="Overdue" value={kpis.overdue} tone="risk" />
      <Tile label="Due this week" value={kpis.week} tone="warn" />
      <Tile label="Needs a next step" value={kpis.needs} />
      <Tile label="Waiting on the USPTO" value={kpis.uspto} />
    </div>
  );
}

/** The edge says why the card is there: overdue wine, due this week amber, the rest quiet. */
const BUCKET_TONE: Record<BucketKey, PillTone> = { overdue: "risk", week: "warn", needs: "mute", quiet: "mute", uspto: "mute", track: "mute" };

/**
 * ONE review card, in the shared Board kit's card look (the same as the Leads board): a bold name, one quiet line (kind, company,
 * mark, stage), the next step with its due chip, then the timeline line: the newest thing SENT OUT for the record. The title is the
 * link to the panel; Done and Open sit below it as plain text links, so nothing interactive is nested.
 */
function ReviewCard({ row, bucket, today, canWrite, params, waitingOnClient }: Common & { row: ReviewRow; bucket: BucketKey; /** A "Waiting on client" card also says how long since we followed up. */ waitingOnClient?: boolean }) {
  const due = row.nextStep ? dueText(row.nextStep.dueDate, today) : null;
  const href = openHref(params, row);
  // The chip at the right of the name: the due date, else "Approval" for a record waiting on one, else a nudge to set a step.
  const chip: { text: string; tone: PillTone } | null = due
    ? { text: due.text, tone: due.overdue ? "risk" : due.text.startsWith("Due") ? "warn" : "mute" }
    : row.waiting === "approval"
      ? { text: "Approval", tone: "warn" }
      : !row.nextStep
        ? { text: "Needs a step", tone: "mute" }
        : null;
  return (
    <BoardCard
      href={href}
      linkScroll={false}
      title={row.client}
      tone={BUCKET_TONE[bucket]}
      className={`rv-card rv-card-${bucket}`}
      data-key={openToken(row)}
      meta={cardSubline(row)}
      step={row.nextStep ? row.nextStep.title : "No next step"}
      chip={!waitingOnClient && chip ? <Pill tone={chip.tone}>{chip.text}</Pill> : undefined}
    >
      <div className="rv-card-sent lx-note" data-sent={row.lastOutbound ? "yes" : row.contactKnown ? "none" : "unknown"}>
        {sentText(row, today, { days: waitingOnClient })}
      </div>
      <Tags row={row} today={today} max={2} skip={["waiting"]} />
      <DocTag row={row} />
      <div className="rv-card-acts">
        {canWrite && row.nextStep && <DoneButton taskId={row.nextStep.id} />}
        <Link href={href} className="lx-link" scroll={false}>
          Open
        </Link>
      </div>
    </BoardCard>
  );
}

/**
 * The board: one column per person (the Board kit's column, wrapping into rows rather than scrolling sideways), each holding two
 * lists, "Our turn" and "Waiting on client". The column says how much the person holds: "Rayn · 12" and, when any, how many of
 * those are overdue or due this week.
 */
export function ReviewBoard({ lanes, ...common }: Common & { lanes: Lane[] }) {
  if (lanes.length === 0) {
    return <EmptyState title="Nothing needs attention">No records are waiting on us or on a client for this view.</EmptyState>;
  }
  return (
    <div className="lx-board rv-board">
      {lanes.map((lane) => {
        const id = lane.userId ?? "none";
        const load = laneLoad(lane, common.today);
        const split = laneLoadText(load);
        return (
          <BoardColumn
            key={id}
            className="rv-person"
            data-lane={id}
            title={lane.name}
            count={load.total}
            ariaLabel={laneLabel(lane.name, load)}
            note={split ? <p className="lx-note rv-lane-load" data-lane-load>{split}</p> : undefined}
          >
            <li className="rv-lane-head lx-label" data-half="our">
              {OUR_TURN} · {lane.our.length}
            </li>
            {lane.our.length === 0 ? (
              <li className="lx-board-empty">Nothing for us to do here.</li>
            ) : (
              lane.our.map((row) => <ReviewCard key={row.key} row={row} bucket={bucketOf(row, common.today)} {...common} />)
            )}
            <li className="rv-lane-head lx-label" data-half="client">
              Waiting on client · {lane.client.length}
            </li>
            {lane.client.length === 0 ? (
              <li className="lx-board-empty">Nobody is waiting on a client.</li>
            ) : (
              lane.client.map((row) => <ReviewCard key={row.key} row={row} bucket={bucketOf(row, common.today)} waitingOnClient {...common} />)
            )}
          </BoardColumn>
        );
      })}
    </div>
  );
}

/** What waits on the review person: next steps assigned to them and approvals. Hidden by the page when there is no such person. */
export function WaitingOnStrip({ firstName, rows, approvalsKnown, params, personId, you }: { firstName: string; /** The strip is about the signed-in approver: "Waiting on you". */ you?: boolean; rows: ReviewRow[]; approvalsKnown: boolean; params: ReviewParams; personId: string; owner?: boolean }) {
  return (
    <section className="lx-card rv-strip" data-strip="person" aria-labelledby="rv-strip-person">
      <div className="rv-strip-head">
        <h2 id="rv-strip-person" className="lx-h3">{you ? WAITING_ON_YOU : `Waiting on ${firstName}`}</h2>
        <span className="rv-strip-count">{rows.length}</span>
      </div>
      {!approvalsKnown && (
        <LoadFailedLine refresh={false}>{you ? WAITING_ON_YOU_PARTIAL : `Approvals couldn't load, so only next steps assigned to ${firstName} are listed.`}</LoadFailedLine>
      )}
      {rows.length === 0 ? (
        approvalsKnown && <EmptyState variant="line">{you ? NOTHING_WAITING_ON_YOU : `Nothing is waiting on ${firstName}.`}</EmptyState>
      ) : (
        <ul className="rv-strip-list">
          {rows.map((r) => {
            const step = r.nextStep?.assigneeId === personId;
            return (
              <li key={r.key}>
                <Link href={openHref(params, r)} className="rv-strip-link" scroll={false}>
                  <Pill tone={step ? "mute" : "warn"}>
                    {r.client} · {step && r.nextStep ? r.nextStep.title : "approval"}
                  </Pill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
