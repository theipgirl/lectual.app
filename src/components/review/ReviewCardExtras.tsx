import type { ReviewRow } from "@/lib/review/buckets";
import type { CloseStage } from "@/lib/review/close-stage";
import { deadlineIsSoon, lastContactText, shortDate } from "@/lib/review/format";
import { lastChangedText } from "@/lib/review/last-changed";
import type { OpenRef } from "@/lib/review/open";
import { REVIEW_SHOWS_PROPOSALS } from "@/lib/review/scope";
import { waitingCell } from "@/lib/review/sheet";
import { logWhatHappenedAction } from "@/app/dashboard/review/actions";
import { Pill } from "@/components/ui/Pill";
import {
  ADD_TO_TIMELINE,
  BLANK,
  LAST_CHANGED_LABEL,
  LAST_CONTACT,
  LEAD_STEP_FACT_PROPOSAL,
  LEAD_STEP_FACT_WAITING,
  RECORD_CARD_STAGE,
  RECORD_CARD_STAGE_READ_ONLY,
  REVIEW_CARD_HEADING,
  REVIEW_CARD_LOG_HEADING,
  REVIEW_CARD_LOG_LABEL,
  REVIEW_CARD_LOG_PLACEHOLDER,
  REVIEW_CARD_NOT_ON_REVIEW,
  REVIEW_CARD_USPTO_DEADLINE,
  reviewCardStageDays,
} from "@/lib/ui/words";
import { ActForm } from "./ActForm";
import { LostNurture } from "./LostNurture";
import "./review.css";

type Member = { userId: string; name: string };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="lx-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The Weekly review's own part of the opened record card (it replaced the review's drawer): the facts the review row
 * computed, which no other page has, and Lost / Nurture for a lead. Read-only roles see the same facts with no form: the
 * page passes `closeStages` only for a role that may move a lead's stage. A row that isn't on the review says so.
 */
export function ReviewCardAside({
  open,
  row,
  members,
  today,
  stagesFailed,
  closeStages,
}: {
  open: OpenRef;
  row: ReviewRow | null;
  members: Member[];
  today: string;
  /** The card's stage read failed: the stage can't be changed, and that is said rather than left blank. */
  stagesFailed: boolean;
  /** Lost / Nurture choices, or an empty list when the role can't move a lead or the firm has no such stage. */
  closeStages: CloseStage[];
}) {
  if (!row) {
    return (
      <section className="rc-sec rv-cardx" aria-label={REVIEW_CARD_HEADING} data-review-card="">
        <h3 className="lx-label">{REVIEW_CARD_HEADING}</h3>
        <p className="lx-note" role="status">
          {REVIEW_CARD_NOT_ON_REVIEW}
        </p>
      </section>
    );
  }
  const names = new Map(members.map((m) => [m.userId, m.name]));
  // No line when the last-change read failed (a failed read is never "not changed").
  const changed = lastChangedText(row.lastChange, names, today);
  return (
    <section className="rc-sec rv-cardx" aria-label={REVIEW_CARD_HEADING} data-review-card="">
      <h3 className="lx-label">{REVIEW_CARD_HEADING}</h3>
      <dl className="rv-cardx-facts">
        <Fact label={RECORD_CARD_STAGE}>
          {row.stageLabel ?? BLANK}
          {row.stageDays !== null ? <span className="lx-note rv-sub">{reviewCardStageDays(row.stageDays)}</span> : row.stageNote ? <span className="lx-note rv-sub">{row.stageNote}</span> : null}
          {stagesFailed && <span className="lx-note rv-sub" role="status">{RECORD_CARD_STAGE_READ_ONLY}</span>}
        </Fact>
        <Fact label={LEAD_STEP_FACT_WAITING}>{waitingCell(row, (d) => shortDate(d, today))}</Fact>
        <Fact label={LAST_CONTACT}>{lastContactText(row, today)}</Fact>
        {changed && <Fact label={LAST_CHANGED_LABEL}>{changed}</Fact>}
        {/* A matter's card draws its own "Next USPTO deadline" from the docket; a lead's comes from the review row. */}
        {open.kind === "lead" && (
          <Fact label={REVIEW_CARD_USPTO_DEADLINE}>
            {row.deadline ? (
              <span className={deadlineIsSoon(row.deadline.dueDate, today) ? "rv-deadline-soon" : undefined}>
                {shortDate(row.deadline.dueDate, today)}
                {row.deadline.title ? <span className="lx-note rv-sub">{row.deadline.title}</span> : null}
              </span>
            ) : (
              BLANK
            )}
          </Fact>
        )}
        {REVIEW_SHOWS_PROPOSALS && row.proposalExpiry && (
          <Fact label={LEAD_STEP_FACT_PROPOSAL}>
            <Pill tone={row.proposalExpiry.expired ? "risk" : "mute"}>{row.proposalExpiry.text}</Pill>
          </Fact>
        )}
      </dl>
      {open.kind === "lead" && closeStages.length > 0 && <LostNurture id={open.id} stages={closeStages} />}
    </section>
  );
}

/**
 * "Log what happened": the review's plain timeline note (`logWhatHappenedAction`, which re-resolves the role, checks the
 * record and refreshes the review). The card draws it only where it would draw a note composer.
 */
export function ReviewCardNote({ open }: { open: OpenRef }) {
  return (
    <div className="rv-cardx-note" id="rv-sec-note">
      <h3 className="lx-label">{REVIEW_CARD_LOG_HEADING}</h3>
      <ActForm action={logWhatHappenedAction} submit={ADD_TO_TIMELINE}>
        <input type="hidden" name="kind" value={open.kind} />
        <input type="hidden" name="id" value={open.id} />
        <textarea className="lx-input" name="body" rows={3} placeholder={REVIEW_CARD_LOG_PLACEHOLDER} aria-label={REVIEW_CARD_LOG_LABEL} required />
      </ActForm>
    </div>
  );
}
