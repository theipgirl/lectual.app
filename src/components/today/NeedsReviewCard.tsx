import Link from "next/link";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { NEEDS_REVIEW_PAST_DUE_DAYS, NEEDS_REVIEW_SHOWN, type NeedsReviewItem } from "@/lib/today/needs-review";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import "./today.css";
import { NEEDS_REVIEW_FAILED, NEEDS_REVIEW_HEADING, needsReviewCut, needsReviewExplain, needsReviewPastDue } from "@/lib/ui/words";

/**
 * The technician Today's "Needs review" card (the calendar's former band). `items` null = the deadline read failed;
 * an ok read with nothing to review draws nothing. Nothing here edits a date: that stays on the matter.
 */
export function NeedsReviewCard({ items }: { items: NeedsReviewItem[] | null }) {
  if (items !== null && items.length === 0) return null;
  return (
    <section className="lx-card lx-band" aria-labelledby="today-needs-review">
      <header className="lx-band-head">
        <h2 id="today-needs-review" className="lx-h2">
          {NEEDS_REVIEW_HEADING}
        </h2>
        {items !== null && <span className="lx-note">{items.length}</span>}
      </header>
      {items === null ? (
        <div className="td-pad-end">
          <LoadFailedLine role="alert" refresh={false}>{NEEDS_REVIEW_FAILED}</LoadFailedLine>
        </div>
      ) : (
        <>
          <p className="lx-note td-pad">
            {needsReviewExplain(NEEDS_REVIEW_PAST_DUE_DAYS)}
          </p>
          <ul className="lx-list td-list">
            {items.slice(0, NEEDS_REVIEW_SHOWN).map((d) => (
              <li key={d.key} className="lx-task">
                <span className="td-body">
                  <Link prefetch={false} href={d.href} className="lx-rowlink">
                    {d.name}
                  </Link>
                  <span className="lx-note td-sub">
                    {`${d.matter} · due ${formatCivilDate(d.dueDate) ?? d.dueDate}`}
                  </span>
                </span>
                <Pill>{needsReviewPastDue(d.daysPastDue)}</Pill>
              </li>
            ))}
          </ul>
          {items.length > NEEDS_REVIEW_SHOWN && (
            <p className="lx-note td-pad-end">
              {needsReviewCut(NEEDS_REVIEW_SHOWN, items.length)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
