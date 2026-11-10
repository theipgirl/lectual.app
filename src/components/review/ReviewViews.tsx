import Link from "next/link";
import { bucketOf, type BucketKey, type ReviewRow } from "@/lib/review/buckets";
import type { ProposalOut } from "@/lib/review/strips";
import { laneOf, type Kpis, type Lane } from "@/lib/review/lanes";
import { dueText, followUpText } from "@/lib/review/format";
import { openToken } from "@/lib/review/open";
import { reviewHref, REVIEW_VIEWS, type ReviewParams, type ReviewView } from "@/lib/review/params";
import { NOTHING_WAITING_ON_YOU, OUR_TURN, WAITING_ON_YOU, WAITING_ON_YOU_PARTIAL, REVIEW_BOARD_VIEW, REVIEW_CARDS_VIEW, REVIEW_SHEET_VIEW } from "@/lib/ui/words";
import { DoneButton } from "./DoneButton";
import { Avatar, openHref, Tags, type Common } from "./shared";
import "@/components/list-page/list-page.css";
import "./review.css";

const VIEW_LABEL: Record<ReviewView, string> = { board: REVIEW_BOARD_VIEW, sheet: REVIEW_SHEET_VIEW, cards: REVIEW_CARDS_VIEW };

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

function Tile({ label, value, tone, owner }: { label: string; value: number | null; tone?: "risk" | "warn"; owner?: boolean }) {
  return (
    <div className={owner ? "lx-card lx-kpi rv-kpi" : "lx-card lx-kpi"}>
      <span className="lx-label">{label}</span>
      <span className="lx-kpi-value" style={tone && value && (owner ? tone === "risk" : true) ? { color: tone === "risk" ? "var(--ox)" : "var(--warn)" } : undefined}>
        {value === null ? "—" : value}
      </span>
      {value === null && <span className="lx-note">Couldn&apos;t load</span>}
    </div>
  );
}

/** Overdue, due this week, needs a next step, waiting on the USPTO. (Approvals and proposals have their own strips.) */
export function KpiStrip({ kpis, owner }: { kpis: Kpis; owner?: boolean }) {
  return (
    <div className="rv-kpis" role="group" aria-label="This week at a glance">
      <Tile label="Overdue" value={kpis.overdue} tone="risk" owner={owner} />
      <Tile label="Due this week" value={kpis.week} tone="warn" owner={owner} />
      <Tile label="Needs a next step" value={kpis.needs} owner={owner} />
      <Tile label="Waiting on the USPTO" value={kpis.uspto} owner={owner} />
    </div>
  );
}

/** The whole card is one link to the panel; Done and Open sit OUTSIDE it, so nothing interactive is nested. */
function LegacyCard({ row, bucket, today, members, canWrite, params, followUp }: Common & { row: ReviewRow; bucket: BucketKey; /** A "Waiting on client" card says when we last followed up. */ followUp?: boolean }) {
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
        {followUp && <span className="rv-card-followup lx-note">{followUpText(row, today)}</span>}
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

/** The whole card is one link to the panel; Done and Open sit OUTSIDE it, so nothing interactive is nested. */
function OwnerCard({ row, bucket, today, canWrite, params, followUp }: Common & { row: ReviewRow; bucket: BucketKey; /** A "Waiting on client" card says when we last followed up. */ followUp?: boolean }) {
  const due = row.nextStep ? dueText(row.nextStep.dueDate, today) : null;
  const href = openHref(params, row);
  // The pill at the right of the step: the due date, else "Approval" for a record waiting on one, else a nudge to set a step.
  const pill = due
    ? { text: due.text, tone: due.overdue ? "risk" : due.text.startsWith("Due") ? "warn" : "plain" }
    : row.waiting === "approval"
      ? { text: "Approval", tone: "ox" }
      : !row.nextStep
        ? { text: "Needs a step", tone: "plain" }
        : null;
  return (
    <article className={`lx-card rv-card rv-card-${bucket}${followUp ? " rv-card-waits" : " rv-card-ours"}`} data-key={openToken(row)}>
      <Link href={href} className="rv-card-link" scroll={false}>
        <span className="rv-card-top">
          <span className="rv-card-title">{row.client}</span>
          <span className="rv-card-meta lx-note">
            {row.kind === "lead" ? "Lead" : "Matter"}
            {row.mark ? ` · ${row.mark}` : ""}
            {row.stageLabel ? ` · ${row.stageLabel}` : ""}
            {row.proposalExpiry ? <span className={row.proposalExpiry.expired ? "rv-deadline-soon" : undefined}>{` · ${row.proposalExpiry.text}`}</span> : null}
          </span>
          {!followUp && pill && <span className={`rv-pill rv-pill-${pill.tone}`}>{pill.text}</span>}
        </span>
        <span className="rv-card-step">
          <span className="rv-card-step-text">{row.nextStep ? row.nextStep.title : "No next step"}</span>
        </span>
        {followUp && <span className="rv-card-followup lx-note">{followUpText(row, today)}</span>}
        <Tags row={row} today={today} max={2} skip={["waiting", "expiry"]} />
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

/** One lane per person, each split in two: "Our move" and "Waiting on client". Stacks under 640px. */
function LegacyBoard({ lanes, ...common }: Common & { lanes: Lane[] }) {
  if (lanes.length === 0) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing needs attention</h2>
        <p className="lx-note" style={{ margin: 0 }}>No records are waiting on us or on a client for this view.</p>
      </div>
    );
  }
  return (
    <div className="rv-board">
      {lanes.map((lane) => {
        const id = lane.userId ?? "none";
        return (
          <section key={id} className="rv-person" aria-labelledby={`rv-person-${id}`}>
            <h2 id={`rv-person-${id}`} className="lx-h2 rv-person-name">
              <Avatar name={lane.name} />
              <span>{lane.name}</span> <span className="lx-note">{lane.count}</span>
            </h2>
            <div className="rv-halves">
              <div className="rv-half" data-half="our">
                <h3 className="lx-label rv-colh">
                  {OUR_TURN} <span className="lx-note">{lane.our.length}</span>
                </h3>
                {lane.our.length === 0 ? (
                  <p className="lx-note rv-none">Nothing for us to do here.</p>
                ) : (
                  <div className="rv-cards">
                    {lane.our.map((row) => (
                      <LegacyCard key={row.key} row={row} bucket={bucketOf(row, common.today)} {...common} />
                    ))}
                  </div>
                )}
              </div>
              <div className="rv-half" data-half="client">
                <h3 className="lx-label rv-colh">
                  Waiting on client <span className="lx-note">{lane.client.length}</span>
                </h3>
                {lane.client.length === 0 ? (
                  <p className="lx-note rv-none">Nobody is waiting on a client.</p>
                ) : (
                  <div className="rv-cards">
                    {lane.client.map((row) => (
                      <LegacyCard key={row.key} row={row} bucket={bucketOf(row, common.today)} followUp {...common} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One lane per person, each split in two: "Our move" and "Waiting on client". Stacks under 640px. */
function OwnerBoard({ lanes, ...common }: Common & { lanes: Lane[] }) {
  if (lanes.length === 0) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing needs attention</h2>
        <p className="lx-note" style={{ margin: 0 }}>No records are waiting on us or on a client for this view.</p>
      </div>
    );
  }
  return (
    <div className="rv-board">
      {lanes.map((lane) => {
        const id = lane.userId ?? "none";
        return (
          <section key={id} className="lx-card rv-person" aria-labelledby={`rv-person-${id}`}>
            <h2 id={`rv-person-${id}`} className="rv-person-name">
              <Avatar name={lane.name} />
              <span>{lane.name}</span> <span className="rv-count">{lane.count}</span>
            </h2>
            <div className="rv-halves">
              <div className="rv-half" data-half="our">
                <h3 className="lx-label rv-colh">
                  {OUR_TURN}
                </h3>
                {lane.our.length === 0 ? (
                  <p className="lx-note rv-none">Nothing for us to do here.</p>
                ) : (
                  <div className="rv-cards">
                    {lane.our.map((row) => (
                      <Card key={row.key} row={row} bucket={bucketOf(row, common.today)} {...common} />
                    ))}
                  </div>
                )}
              </div>
              <div className="rv-half" data-half="client">
                <h3 className="lx-label rv-colh">
                  Waiting on client
                </h3>
                {lane.client.length === 0 ? (
                  <p className="lx-note rv-none">Nobody is waiting on a client.</p>
                ) : (
                  <div className="rv-cards">
                    {lane.client.map((row) => (
                      <Card key={row.key} row={row} bucket={bucketOf(row, common.today)} followUp {...common} />
                    ))}
                  </div>
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
function LegacyProposalsOutStrip({ items, known, params }: { items: ProposalOut[]; known: boolean; params: ReviewParams }) {
  return (
    <section className="lx-card rv-strip" data-strip="proposals" aria-labelledby="rv-strip-proposals">
      <h2 id="rv-strip-proposals" className="lx-h2 rv-strip-title">
        Proposals out {known && <span className="lx-note">{items.length}</span>}
      </h2>
      {!known ? (
        <p className="lx-note rv-strip-note" role="status">Proposals couldn&apos;t load. Refresh to try again.</p>
      ) : items.length === 0 ? (
        <p className="lx-note rv-strip-note">No proposals out.</p>
      ) : (
        <ul className="rv-strip-list">
          {items.map((p) => (
            <li key={p.row.key}>
              <Link href={openHref(params, p.row)} scroll={false}>{p.row.client}</Link>{" "}
              <span className={`rv-strip-when${p.expired ? " rv-deadline-soon" : ""}`}>{p.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What waits on the review person: next steps assigned to them and approvals. Hidden by the page when there is no such person. */
function LegacyWaitingOnStrip({ firstName, rows, approvalsKnown, params, personId, you }: { firstName: string; /** The strip is about the signed-in approver: "Waiting on you". */ you?: boolean; rows: ReviewRow[]; approvalsKnown: boolean; params: ReviewParams; personId: string }) {
  return (
    <section className="lx-card rv-strip" data-strip="person" aria-labelledby="rv-strip-person">
      <h2 id="rv-strip-person" className="lx-h2 rv-strip-title">
        {you ? WAITING_ON_YOU : `Waiting on ${firstName}`} <span className="lx-note">{rows.length}</span>
      </h2>
      {!approvalsKnown && (
        <p className="lx-note rv-strip-note" role="status">{you ? WAITING_ON_YOU_PARTIAL : `Approvals couldn't load, so only next steps assigned to ${firstName} are listed.`}</p>
      )}
      {rows.length === 0 ? (
        approvalsKnown && <p className="lx-note rv-strip-note">{you ? NOTHING_WAITING_ON_YOU : `Nothing is waiting on ${firstName}.`}</p>
      ) : (
        <ul className="rv-strip-list">
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={openHref(params, r)} scroll={false}>{r.client}</Link>{" "}
              <span className="lx-note">
                {r.nextStep?.assigneeId === personId ? `Next step: ${r.nextStep.title}` : "Waiting on approval"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/** Proposals that are out, soonest last day first. A failed read says so; it is never "none". */
function OwnerProposalsOutStrip({ items, known, params }: { items: ProposalOut[]; known: boolean; params: ReviewParams }) {
  return (
    <section className="lx-card rv-strip" data-strip="proposals" aria-labelledby="rv-strip-proposals">
      <div className="rv-strip-head">
        <h2 id="rv-strip-proposals" className="rv-strip-title">Proposals out</h2>
        {known && <span className="rv-strip-count">{items.length} · soonest last day first</span>}
      </div>
      {!known ? (
        <p className="lx-note rv-strip-note" role="status">Proposals couldn&apos;t load. Refresh to try again.</p>
      ) : items.length === 0 ? (
        <p className="lx-note rv-strip-note">No proposals out.</p>
      ) : (
        <ul className="rv-strip-list">
          {items.map((p) => (
            <li key={p.row.key}>
              <Link href={openHref(params, p.row)} className={`rv-pill ${p.expired ? "rv-pill-risk" : "rv-pill-plain"}`} scroll={false}>
                {p.row.client} · <span className={`rv-strip-when${p.expired ? " rv-deadline-soon" : ""}`}>{p.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What waits on the review person: next steps assigned to them and approvals. Hidden by the page when there is no such person. */
function OwnerWaitingOnStrip({ firstName, rows, approvalsKnown, params, personId, you }: { firstName: string; /** The strip is about the signed-in approver: "Waiting on you". */ you?: boolean; rows: ReviewRow[]; approvalsKnown: boolean; params: ReviewParams; personId: string }) {
  return (
    <section className="lx-card rv-strip" data-strip="person" aria-labelledby="rv-strip-person">
      <div className="rv-strip-head">
        <h2 id="rv-strip-person" className="rv-strip-title">{you ? WAITING_ON_YOU : `Waiting on ${firstName}`}</h2>
        <span className="rv-strip-count">{rows.length} · next steps and approvals</span>
      </div>
      {!approvalsKnown && (
        <p className="lx-note rv-strip-note" role="status">{you ? WAITING_ON_YOU_PARTIAL : `Approvals couldn't load, so only next steps assigned to ${firstName} are listed.`}</p>
      )}
      {rows.length === 0 ? (
        approvalsKnown && <p className="lx-note rv-strip-note">{you ? NOTHING_WAITING_ON_YOU : `Nothing is waiting on ${firstName}.`}</p>
      ) : (
        <ul className="rv-strip-list">
          {rows.map((r) => {
            const step = r.nextStep?.assigneeId === personId;
            return (
              <li key={r.key}>
                <Link href={openHref(params, r)} className={`rv-pill ${step ? "rv-pill-plain" : "rv-pill-ox"}`} scroll={false}>
                  {r.client} · {step && r.nextStep ? r.nextStep.title : "approval"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Technician view: the markup as it was before the owner restyle. Owner view: the board's look. */
export function Card(props: Parameters<typeof OwnerCard>[0]) {
  return props.owner ? <OwnerCard {...props} /> : <LegacyCard {...props} />;
}

export function ReviewBoard(props: Parameters<typeof OwnerBoard>[0]) {
  return props.owner ? <OwnerBoard {...props} /> : <LegacyBoard {...props} />;
}

export function ProposalsOutStrip(props: Parameters<typeof OwnerProposalsOutStrip>[0] & { owner?: boolean }) {
  return props.owner ? <OwnerProposalsOutStrip {...props} /> : <LegacyProposalsOutStrip {...props} />;
}

export function WaitingOnStrip(props: Parameters<typeof OwnerWaitingOnStrip>[0] & { owner?: boolean }) {
  return props.owner ? <OwnerWaitingOnStrip {...props} /> : <LegacyWaitingOnStrip {...props} />;
}
