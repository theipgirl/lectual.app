import type { ReviewRow } from "@/lib/review/buckets";
import type { CloseStage } from "@/lib/review/close-stage";
import { deadlineIsSoon, lastContactText, shortDate } from "@/lib/review/format";
import { lastChangedText } from "@/lib/review/last-changed";
import type { OpenRef } from "@/lib/review/open";
import { REVIEW_SHOWS_PROPOSALS } from "@/lib/review/scope";
import { waitingCell } from "@/lib/review/sheet";
import type { FactCell } from "@/lib/review/sheet-cells";
import type { FirmColumnsBlock } from "@/lib/custom-columns/rules";
import { Pill } from "@/components/ui/Pill";
import {
  BLANK,
  DECK_COULDNT_LOAD,
  FIRM_COLUMNS_HEADING,
  LAST_CHANGED_LABEL,
  LAST_CONTACT,
  LEAD_STEP_COULDNT_LOAD,
  LEAD_STEP_FACT_PROPOSAL,
  LEAD_STEP_FACT_WAITING,
  RECORD_CARD_STAGE,
  RECORD_CARD_STAGE_READ_ONLY,
  REVIEW_CARD_HEADING,
  REVIEW_CARD_NOT_ON_REVIEW,
  REVIEW_CARD_USPTO_DEADLINE,
  reviewCardStageDays,
} from "@/lib/ui/words";
import { LostNurture } from "./LostNurture";
import { FirmColumnsEdit } from "./FirmColumnsEdit";
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

/** One firm column's value: plain text with its quiet title (from the lead, from a merged duplicate); a dash or "Couldn't load" is quiet. */
function FirmCell({ cell }: { cell: FactCell }) {
  return cell.tone === "value" ? (
    <span title={cell.title}>{cell.text}</span>
  ) : (
    <span className="lx-note" title={cell.title}>
      {cell.text}
    </span>
  );
}

/**
 * "Firm columns": the firm's own columns for the record shown. The values (a dash where nothing is recorded) or "Couldn't load". Before
 * the columns are switched on for the firm, NOTHING is drawn, for every role (CO4: that is the admin tier's to know, on the List and in
 * Settings). A firm with no column for this record's section draws nothing. Items that carry `edit` (a staff role, decided by the page)
 * are typed in place through `FirmColumnsEdit`; this component itself writes nothing.
 */
export function FirmColumns({ block, members = null, today = "", recordKey = "" }: { block: FirmColumnsBlock | null | undefined; members?: Member[] | null; today?: string; recordKey?: string }) {
  if (!block || block.status === "not-set-up" || (block.status === "ok" && block.items.length === 0)) return null;
  return (
    <div className="rv-cardx-firm" data-firm-columns={block.status}>
      <h4 className="lx-label">{FIRM_COLUMNS_HEADING}</h4>
      {block.status === "unavailable" ? (
        <p className="lx-note" role="status">
          {DECK_COULDNT_LOAD}
        </p>
      ) : block.items.some((item) => item.edit) ? (
        <FirmColumnsEdit items={block.items} members={members} today={today} recordKey={recordKey} />
      ) : (
        <dl className="rv-cardx-facts">
          {block.items.map((item, i) => (
            <Fact key={`${i}:${item.label}`} label={item.label}>
              <FirmCell cell={item.cell} />
            </Fact>
          ))}
        </dl>
      )}
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
  deadlinesFailed = false,
  firmColumns = null,
}: {
  open: OpenRef;
  row: ReviewRow | null;
  members: Member[];
  today: string;
  /** The card's stage read failed AND this role has the stage edit: then "the stage can't be changed here" is said. Never for a role that couldn't change it anyway. */
  stagesFailed: boolean;
  /** Lost / Nurture choices, or an empty list when the role can't move a lead or the firm has no such stage. */
  closeStages: CloseStage[];
  /** The review's deadline read failed: a lead's USPTO deadline says "Couldn't load", never "—" (a failed read is never "none"). */
  deadlinesFailed?: boolean;
  /** The firm's own columns for the record shown (read only), worked out by the page; null draws no block. */
  firmColumns?: FirmColumnsBlock | null;
}) {
  if (!row) {
    return (
      <section className="rc-sec rv-cardx" aria-label={REVIEW_CARD_HEADING} data-review-card="">
        <h3 className="lx-label">{REVIEW_CARD_HEADING}</h3>
        <p className="lx-note" role="status">
          {REVIEW_CARD_NOT_ON_REVIEW}
        </p>
        <FirmColumns block={firmColumns} members={members} today={today} recordKey={`${open.kind}:${open.id}`} />
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
            ) : deadlinesFailed ? (
              <span className="lx-note" role="status">
                {LEAD_STEP_COULDNT_LOAD}
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
      <FirmColumns block={firmColumns} members={members} today={today} recordKey={`${open.kind}:${open.id}`} />
      {open.kind === "lead" && closeStages.length > 0 && <LostNurture id={open.id} stages={closeStages} />}
    </section>
  );
}
