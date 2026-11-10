import { civilDaysBetween } from "@/lib/matters/calendar-rows";
import { NEEDS_REVIEW_PAST_DUE_DAYS, deadlineKindLabel, deadlineNeedsReview } from "@/lib/matters/deadline-rules";
import type { UpcomingDeadline } from "@/lib/matters";

/** Rows shown on a Today card before it says how many more there are. */
export const NEEDS_REVIEW_SHOWN = 8;
export { NEEDS_REVIEW_PAST_DUE_DAYS };

export type NeedsReviewItem = {
  key: string;
  href: string;
  /** What the date is: its own title, else the kind's label. */
  name: string;
  /** Matter number and title. */
  matter: string;
  dueDate: string;
  daysPastDue: number;
};

/**
 * The open, unconfirmed, hand-entered dates more than NEEDS_REVIEW_PAST_DUE_DAYS past due (the calendar's former
 * "Needs review" band), oldest first. Uses the same predicate the rest of Today uses to leave them out.
 * `todayCivil` is the firm's civil date. Nothing here edits or closes a date.
 */
export function needsReviewItems(rows: readonly UpcomingDeadline[], todayCivil: string): NeedsReviewItem[] {
  return rows
    .filter((d) => deadlineNeedsReview(d, todayCivil))
    .map((d) => ({
      key: d.id,
      href: `/dashboard/matters/${d.matter_id}/`,
      name: d.title ?? deadlineKindLabel(d.kind),
      matter: [d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket",
      dueDate: d.due_date,
      daysPastDue: Math.max(0, civilDaysBetween(d.due_date, todayCivil)),
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
