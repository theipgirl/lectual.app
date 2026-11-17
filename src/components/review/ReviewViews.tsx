import Link from "next/link";
import { bucketOf, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import type { ProposalOut } from "@/lib/review/strips";
import { type Kpis, type Lane } from "@/lib/review/lanes";
import { dueText, followUpText } from "@/lib/review/format";
import { openToken } from "@/lib/review/open";
import { reviewHref, REVIEW_VIEWS, type ReviewParams, type ReviewView } from "@/lib/review/params";
import { NOTHING_WAITING_ON_YOU, OUR_TURN, WAITING_ON_YOU, WAITING_ON_YOU_PARTIAL, REVIEW_BOARD_VIEW, REVIEW_CARDS_VIEW, REVIEW_SHEET_VIEW } from "@/lib/ui/words";
import { DoneButton } from "./DoneButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import type { PillTone } from "@/lib/ui/tones";
import { Avatar, DocTag, openHref, Tags, type Common } from "./shared";
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
 * ONE review card, in the shared board-card look: a bold name, one quiet line, the next step, a due or age chip. The whole top is one
 * link to the panel; Done and Open sit OUTSIDE it as plain text links, so nothing interactive is nested.
 */
function ReviewCard({ row, bucket, today, canWrite, params, followUp }: Common & { row: ReviewRow; bucket: BucketKey; /** A "Waiting on client" card says when we last followed up. */ followUp?: boolean }) {
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
    <li className={`lx-board-card rv-card rv-card-${bucket}`} data-tone={BUCKET_TONE[bucket]} data-key={openToken(row)}>
      <Link href={href} className="rv-card-link" scroll={false}>
        <span className="lx-board-card-top">
          <span className="lx-board-card-title">{row.client}</span>
          {!followUp && chip && <Pill tone={chip.tone}>{chip.text}</Pill>}
        </span>
        <span className="lx-board-card-meta">
          {row.kind === "lead" ? "Lead" : "Matter"}
          {row.mark ? ` · ${row.mark}` : ""}
          {row.stageLabel ? ` · ${row.stageLabel}` : ""}
          {row.proposalExpiry ? <span className={row.proposalExpiry.expired ? "rv-deadline-soon" : undefined}>{` · ${row.proposalExpiry.text}`}</span> : null}
        </span>
        <span className="lx-board-card-step">{row.nextStep ? row.nextStep.title : "No next step"}</span>
        {followUp && <span className="rv-card-followup lx-note">{followUpText(row, today)}</span>}
        <Tags row={row} today={today} max={2} skip={["waiting", "expiry"]} />
        <DocTag row={row} />
      </Link>
      <div className="rv-card-acts">
        {canWrite && row.nextStep && <DoneButton taskId={row.nextStep.id} />}
        <Link href={href} className="lx-link" scroll={false}>
          Open
        </Link>
      </div>
    </li>
  );
}

/** One lane per person (a filled column), each split in two: "Our turn" and "Waiting on client". Stacks under 900px. */
export function ReviewBoard({ lanes, ...common }: Common & { lanes: Lane[] }) {
  if (lanes.length === 0) {
    return <EmptyState title="Nothing needs attention">No records are waiting on us or on a client for this view.</EmptyState>;
  }
  return (
    <div className="rv-board">
      {lanes.map((lane) => {
        const id = lane.userId ?? "none";
        return (
          <section key={id} className="lx-board-col rv-person" aria-labelledby={`rv-person-${id}`}>
            <h2 id={`rv-person-${id}`} className="rv-person-name">
              <Avatar name={lane.name} />
              <span>{lane.name}</span> <span className="rv-count">{lane.count}</span>
            </h2>
            <div className="rv-halves">
              <div className="rv-half" data-half="our">
                <h3 className="lx-label rv-colh">{OUR_TURN}</h3>
                {lane.our.length === 0 ? (
                  <EmptyState variant="line">Nothing for us to do here.</EmptyState>
                ) : (
                  <ul className="lx-board-cards rv-cards">
                    {lane.our.map((row) => (
                      <ReviewCard key={row.key} row={row} bucket={bucketOf(row, common.today)} {...common} />
                    ))}
                  </ul>
                )}
              </div>
              <div className="rv-half" data-half="client">
                <h3 className="lx-label rv-colh">Waiting on client</h3>
                {lane.client.length === 0 ? (
                  <EmptyState variant="line">Nobody is waiting on a client.</EmptyState>
                ) : (
                  <ul className="lx-board-cards rv-cards">
                    {lane.client.map((row) => (
                      <ReviewCard key={row.key} row={row} bucket={bucketOf(row, common.today)} followUp {...common} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Proposals that are out, soonest last day first. A failed read says so; it is never "none". */
export function ProposalsOutStrip({ items, known, params }: { items: ProposalOut[]; known: boolean; params: ReviewParams; owner?: boolean }) {
  return (
    <section className="lx-card rv-strip" data-strip="proposals" aria-labelledby="rv-strip-proposals">
      <div className="rv-strip-head">
        <h2 id="rv-strip-proposals" className="lx-h3">Proposals out</h2>
        {known && <span className="rv-strip-count">{items.length}</span>}
      </div>
      {!known ? (
        <LoadFailedLine>Proposals couldn&apos;t load. Refresh to try again.</LoadFailedLine>
      ) : items.length === 0 ? (
        <EmptyState variant="line">No proposals out.</EmptyState>
      ) : (
        <ul className="rv-strip-list">
          {items.map((p) => (
            <li key={p.row.key}>
              <Link href={openHref(params, p.row)} className="rv-strip-link" scroll={false}>
                <Pill tone={p.expired ? "risk" : "mute"}>
                  {p.row.client} · <span className={`rv-strip-when${p.expired ? " rv-deadline-soon" : ""}`}>{p.text}</span>
                </Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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
