import Link from "next/link";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { NEEDS_REVIEW_PAST_DUE_DAYS, NEEDS_REVIEW_SHOWN, type NeedsReviewItem } from "@/lib/today/needs-review";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { NEEDS_REVIEW_FAILED, NEEDS_REVIEW_HEADING, needsReviewCut, needsReviewExplain, needsReviewPastDue } from "@/lib/ui/words";

/** Owner Today's "Needs review" card. `items` null = the read failed; an empty read draws nothing. */
export function OwnerNeedsReview({ items }: { items: NeedsReviewItem[] | null }) {
  if (items !== null && items.length === 0) return null;
  return (
    <section className="lx-card ot-card" aria-labelledby="ot-review-h">
      <div className="ot-card-head">
        <h2 id="ot-review-h" className="lx-h3">
          {NEEDS_REVIEW_HEADING}
        </h2>
        {items !== null && <span className="ot-count">{items.length}</span>}
      </div>
      {items === null ? (
        <Notice tone="warn" role="alert">
          {NEEDS_REVIEW_FAILED}
        </Notice>
      ) : (
        <>
          <p className="lx-note ot-explain">{needsReviewExplain(NEEDS_REVIEW_PAST_DUE_DAYS)}</p>
          {items.slice(0, NEEDS_REVIEW_SHOWN).map((d) => (
            <div key={d.key} className="ot-row">
              <div className="ot-row-main">
                <Link href={d.href} className="ot-row-title">
                  {d.name}
                </Link>
                <span className="ot-sub ot-line">
                  {d.matter} &middot; {formatCivilDate(d.dueDate) ?? d.dueDate}
                </span>
              </div>
              <Pill tone="warn">{needsReviewPastDue(d.daysPastDue)}</Pill>
            </div>
          ))}
          {items.length > NEEDS_REVIEW_SHOWN && <p className="lx-note ot-foot">{needsReviewCut(NEEDS_REVIEW_SHOWN, items.length)}</p>}
        </>
      )}
    </section>
  );
}
