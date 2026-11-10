import Link from "next/link";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { NEEDS_REVIEW_PAST_DUE_DAYS, NEEDS_REVIEW_SHOWN, type NeedsReviewItem } from "@/lib/today/needs-review";
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
        <p className="lx-note" role="alert" style={{ margin: 0, padding: "0 18px 14px", color: "var(--warn)" }}>
          {NEEDS_REVIEW_FAILED}
        </p>
      ) : (
        <>
          <p className="lx-note" style={{ margin: 0, padding: "0 18px" }}>
            {needsReviewExplain(NEEDS_REVIEW_PAST_DUE_DAYS)}
          </p>
          <ul className="lx-list" style={{ padding: "0 18px 8px" }}>
            {items.slice(0, NEEDS_REVIEW_SHOWN).map((d) => (
              <li key={d.key} className="lx-task">
                <span style={{ minWidth: 0 }}>
                  <Link prefetch={false} href={d.href} className="lx-rowlink">
                    {d.name}
                  </Link>
                  <span className="lx-note" style={{ display: "block" }}>
                    {`${d.matter} · due ${formatCivilDate(d.dueDate) ?? d.dueDate}`}
                  </span>
                </span>
                <span className="lx-pill lx-pill-mute">{needsReviewPastDue(d.daysPastDue)}</span>
              </li>
            ))}
          </ul>
          {items.length > NEEDS_REVIEW_SHOWN && (
            <p className="lx-note" style={{ margin: 0, padding: "0 18px 14px" }}>
              {needsReviewCut(NEEDS_REVIEW_SHOWN, items.length)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
