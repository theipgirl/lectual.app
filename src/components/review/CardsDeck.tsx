import Link from "next/link";
import { BUCKET_COPY } from "@/lib/review/buckets";
import type { DeckCard, DeckPerson } from "@/lib/review/deck";
import type { LatestNote } from "@/lib/review/detail-load";
import type { MeetingPosition } from "@/lib/review/lanes";
import { dueText, lastContactText } from "@/lib/review/format";
import { reviewHref } from "@/lib/review/params";
import { SNOOZE_LABEL } from "@/lib/review/snooze";
import { WAITING_LABEL } from "@/lib/review/waiting";
import { deckDoneAction, deckHandToAction, deckNoteAction, deckSnoozeAction } from "@/app/dashboard/review/card-actions";
import { DeckKeys } from "./DeckKeys";
import { Avatar, openHref, Tags, type Common } from "./shared";
import "./review.css";

const MAX_DOTS = 40;

/** The people across the top: links, so the URL carries the person. */
export function PersonChips({ people, personId, params }: { people: DeckPerson[]; personId: string | null; params: Common["params"] }) {
  return (
    <nav className="rv-people" aria-label="Whose cards">
      {people.map((p) => (
        <Link
          key={p.userId}
          href={reviewHref({ ...params, view: "cards", person: p.userId, i: 1, open: null })}
          className={`rv-person-chip${p.userId === personId ? " on" : ""}`}
          aria-current={p.userId === personId ? "page" : undefined}
        >
          <Avatar name={p.name} />
          {p.name}
        </Link>
      ))}
    </nav>
  );
}

/**
 * One big card at a time. Every button is a plain form or link, so the deck works without JavaScript; the arrow keys are a
 * bonus. The buttons run the same actions as the detail panel and then land back on the same place in the deck.
 */
export function CardsDeck({
  card,
  pos,
  personName,
  personId,
  note,
  ...common
}: Common & { card: DeckCard | null; pos: MeetingPosition | null; personName: string | null; personId: string | null; note: LatestNote | null }) {
  const { params, today, members, canWrite } = common;
  if (!card || !pos) {
    return (
      <div className="lx-card lx-empty-card">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>
          Nothing on {personName ?? "this person"}&apos;s cards right now.
        </h2>
        <p className="lx-note" style={{ margin: 0 }}>Nothing is overdue, due this week or missing a next step for them.</p>
      </div>
    );
  }
  const { row, bucket } = card;
  const here = { ...params, view: "cards" as const, person: personId };
  const href = (i: number) => reviewHref({ ...here, i, open: null });
  const due = row.nextStep ? dueText(row.nextStep.dueDate, today) : null;
  const stepWho = row.nextStep?.assigneeId ? members.find((m) => m.userId === row.nextStep?.assigneeId)?.name ?? "Teammate" : null;
  const dots = Math.min(pos.total, MAX_DOTS);
  const dotAt = pos.total <= MAX_DOTS ? pos.index : Math.floor((pos.index / pos.total) * MAX_DOTS);
  const view = (
    <>
      <input type="hidden" name="vwho" value={params.who === "mine" ? "mine" : ""} />
      <input type="hidden" name="vkind" value={params.kind === "matter" ? "matters" : params.kind === "lead" ? "leads" : ""} />
      <input type="hidden" name="vq" value={params.q} />
      <input type="hidden" name="vsince" value={params.since === "all" ? "all" : ""} />
      <input type="hidden" name="vperson" value={personId ?? ""} />
      <input type="hidden" name="vi" value={pos.position} />
    </>
  );
  const record = (
    <>
      <input type="hidden" name="kind" value={row.kind} />
      <input type="hidden" name="id" value={row.id} />
    </>
  );

  return (
    <div className="rv-deck">
      <DeckKeys />
      <p className="lx-note rv-prog" role="status">
        {pos.position} of {pos.total} · {BUCKET_COPY[bucket].label}
      </p>
      <div className="rv-dots" aria-hidden="true">
        {Array.from({ length: dots }, (_, n) => (
          <span key={n} className={`rv-dot${n === dotAt ? " on" : n < dotAt ? " past" : ""}`} />
        ))}
      </div>

      <article className={`lx-card rv-big rv-card-${bucket}`}>
        <h2 className="rv-big-title">
          <Link href={openHref({ ...here, i: pos.position }, row)} scroll={false}>
            {row.client}
          </Link>
        </h2>
        <p className="lx-note rv-big-meta">
          {row.kind === "lead" ? "Lead" : "Matter"}
          {row.mark ? ` · ${row.mark}` : ""}
          {row.stageLabel ? ` · ${row.stageLabel}` : ""}
        </p>
        <p className="rv-big-step">{row.nextStep ? row.nextStep.title : "No next step"}</p>
        {due && (
          <p className="rv-big-due">
            <span className={`rv-chip${due.overdue ? " rv-chip-overdue" : ""}`}>{due.text}</span>
            {stepWho && <span className="lx-note"> · {stepWho}</span>}
          </p>
        )}
        <dl className="rv-facts">
          <div>
            <dt className="lx-label">Waiting on</dt>
            <dd>{row.waiting ? WAITING_LABEL[row.waiting] : "—"}</dd>
          </div>
          <div>
            <dt className="lx-label">Last contact</dt>
            <dd>{lastContactText(row, today)}</dd>
          </div>
        </dl>
        <Tags row={row} today={today} />
        {note && (
          <p className="rv-big-note lx-note">
            {note.status === "unavailable" ? "The latest note couldn't load." : note.text ? `Latest note: ${note.text}` : "No notes yet."}
          </p>
        )}

        {canWrite ? (
          <div className="rv-big-acts">
            {row.nextStep && (
              <form action={deckDoneAction}>
                {view}
                <input type="hidden" name="taskId" value={row.nextStep.id} />
                <button type="submit" className="lx-btn lx-btn-pri">
                  Done
                </button>
              </form>
            )}
            {row.nextStep &&
              (["tomorrow", "monday"] as const).map((c) => (
                <form key={c} action={deckSnoozeAction}>
                  {view}
                  <input type="hidden" name="taskId" value={row.nextStep?.id ?? ""} />
                  <input type="hidden" name="when" value={c} />
                  <button type="submit" className="lx-btn lx-btn-sec">
                    Snooze: {SNOOZE_LABEL[c]}
                  </button>
                </form>
              ))}
            <form action={deckHandToAction} className="rv-handto">
              {view}
              {record}
              {row.nextStep && <input type="hidden" name="taskId" value={row.nextStep.id} />}
              <select className="lx-input" name="assigneeId" aria-label="Hand to" defaultValue={row.nextStep?.assigneeId ?? row.assignedTo ?? ""}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="lx-btn lx-btn-sec">
                Hand to
              </button>
            </form>
            <details className="rv-more rv-note-box">
              <summary className="lx-btn lx-btn-sec">Add note</summary>
              <form action={deckNoteAction} className="rv-form">
                {view}
                {record}
                <textarea className="lx-input" name="body" rows={3} placeholder="A short note for the timeline" aria-label="What happened" required />
                <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm">
                  Add to timeline
                </button>
              </form>
            </details>
          </div>
        ) : null}
        <div className="rv-big-acts">
          <Link href={openHref({ ...here, i: pos.position }, row)} className="lx-btn lx-btn-sec" scroll={false}>
            Open
          </Link>
        </div>
      </article>

      <nav className="rv-pager" aria-label="Cards">
        {pos.prev ? (
          <Link className="lx-btn lx-btn-ghost" href={href(pos.prev)} data-deck-prev>
            ← Back
          </Link>
        ) : (
          <span />
        )}
        {pos.next ? (
          <Link className="lx-btn lx-btn-sec" href={href(pos.next)} data-deck-next>
            Skip →
          </Link>
        ) : (
          <span className="lx-note">That&apos;s the last card.</span>
        )}
      </nav>
    </div>
  );
}
