import type { Direction, Waiting } from "./waiting";
import type { ContactType } from "./contact";
import type { ProposalExpiryTag } from "./proposal-expiry";

/**
 * The weekly review's sections. Pure: rows in, buckets out. A row is in exactly ONE section, the
 * first that applies:
 *   1 Overdue follow-ups  - the next step is due before today
 *   2 Due this week       - the next step is due today through six days on
 *   3 Needs a next step   - no open task, or a task with no due date ("No date set"), and not waiting on the USPTO
 *   4 Quiet 14+ days      - has a dated next step, not due this week, no contact for 14+ days (or none)
 *   5 Waiting on the USPTO
 *   6 On track
 * A record with the USPTO (waiting) skips 3 and 4: silence from the office is normal, and a missing
 * task there is not a gap. If last contact could not be read, 4 is skipped (never guessed).
 */

export type ReviewKind = "matter" | "lead";

export type ReviewNextStep = {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null when the task has no due date. */
  dueDate: string | null;
  assigneeId: string | null;
};

export type ReviewRow = {
  key: string;
  kind: ReviewKind;
  id: string;
  href: string;
  client: string;
  mark: string | null;
  stageLabel: string | null;
  /** The docket stage's own code ("19A"), when the record has one. */
  stageCode?: string | null;
  /** The matter type code (TM, CR, PATENT, BL, LIT, ...). Absent on a lead, or when unknown (read as TM). */
  matterType?: string | null;
  stageDays: number | null;
  /** "In stage since import" etc. when there is no day count. */
  stageNote: string | null;
  /** Sort key for "pipeline order": leads by their stage order, matters after them by docket order. */
  stageOrder: number | null;
  assignedTo: string | null;
  /** false when the activity read failed: last contact is unknown, not "none". */
  contactKnown: boolean;
  /** YYYY-MM-DD in the firm's zone, and the timeline type it came from. */
  lastContact: { date: string; type: ContactType } | null;
  waiting: Waiting | null;
  lastDirection: Direction | null;
  /** YYYY-MM-DD in the firm's zone of the newest OUTBOUND contact (we emailed / called). Null = none recorded or unreadable (see `contactKnown`). */
  lastOutbound?: string | null;
  /** Where the lead / matter came from (`referral_source`), if recorded. */
  source?: string | null;
  nextStep: ReviewNextStep | null;
  /** The nearest open USPTO deadline (matters only). */
  deadline: { dueDate: string; title: string | null } | null;
  /** A live proposal's expiry, drawn as a tag only. Never moves a row between sections. Absent = none, or the read failed. */
  proposalExpiry?: ProposalExpiryTag | null;
};

export const BUCKET_KEYS = ["overdue", "week", "needs", "quiet", "uspto", "track"] as const;
export type BucketKey = (typeof BUCKET_KEYS)[number];

export const BUCKET_COPY: Record<BucketKey, { label: string; hint: string }> = {
  overdue: { label: "Overdue follow-ups", hint: "the next step is past due" },
  week: { label: "Due this week", hint: "the next step is due in the next seven days" },
  needs: { label: "Needs a next step", hint: "nothing is set, or a step has no date" },
  quiet: { label: "Quiet 14+ days", hint: "no contact in two weeks or more" },
  uspto: { label: "Waiting on the USPTO", hint: "nothing to do but watch" },
  track: { label: "On track", hint: "a next step is set and contact is recent" },
};

/** Sections that start collapsed. */
export const COLLAPSED_BUCKETS: readonly BucketKey[] = ["uspto", "track"];

export const QUIET_DAYS = 14;
export const WEEK_DAYS = 6;

function civilToUtc(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); NaN if either is unreadable. */
export function daysBetween(from: string, to: string): number {
  return Math.round((civilToUtc(to) - civilToUtc(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const t = civilToUtc(date) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function bucketOf(row: ReviewRow, today: string): BucketKey {
  const due = row.nextStep?.dueDate ?? null;
  if (due && due < today) return "overdue";
  if (due && due <= addDays(today, WEEK_DAYS)) return "week";
  const withUspto = row.waiting === "uspto";
  // A task with no due date IS a next step, but nothing is scheduled: it needs a date.
  if ((!row.nextStep || !due) && !withUspto) return "needs";
  if (row.nextStep && !withUspto && row.contactKnown) {
    const quiet = row.lastContact === null || daysBetween(row.lastContact.date, today) >= QUIET_DAYS;
    if (quiet) return "quiet";
  }
  if (withUspto) return "uspto";
  return "track";
}

const byText = (a: string, b: string) => a.localeCompare(b, "en");
const dueKey = (r: ReviewRow) => r.nextStep?.dueDate ?? "9999-12-31";
const contactKey = (r: ReviewRow) => r.lastContact?.date ?? "0000-00-00";

const SORT: Record<BucketKey, (a: ReviewRow, b: ReviewRow) => number> = {
  overdue: (a, b) => byText(dueKey(a), dueKey(b)) || byText(a.client, b.client),
  week: (a, b) => byText(dueKey(a), dueKey(b)) || byText(a.client, b.client),
  needs: (a, b) => (b.stageDays ?? -1) - (a.stageDays ?? -1) || byText(a.client, b.client),
  quiet: (a, b) => byText(contactKey(a), contactKey(b)) || byText(a.client, b.client),
  uspto: (a, b) => byText(a.deadline?.dueDate ?? "9999-12-31", b.deadline?.dueDate ?? "9999-12-31") || byText(a.client, b.client),
  track: (a, b) => byText(a.client, b.client),
};

export type ReviewBuckets = { sections: Record<BucketKey, ReviewRow[]>; counts: Record<BucketKey, number>; total: number };

export function reviewBuckets(rows: readonly ReviewRow[], today: string): ReviewBuckets {
  const sections = Object.fromEntries(BUCKET_KEYS.map((k) => [k, [] as ReviewRow[]])) as Record<BucketKey, ReviewRow[]>;
  for (const row of rows) sections[bucketOf(row, today)].push(row);
  for (const key of BUCKET_KEYS) sections[key].sort(SORT[key]);
  const counts = Object.fromEntries(BUCKET_KEYS.map((k) => [k, sections[k].length])) as Record<BucketKey, number>;
  return { sections, counts, total: rows.length };
}

/** "3 overdue · 5 due this week · 12 need a next step · 4 quiet" - only the non-zero attention counts. */
export function reviewSubline(b: ReviewBuckets): string {
  if (b.total === 0) return "Nothing to review.";
  const parts: string[] = [];
  if (b.counts.overdue) parts.push(`${b.counts.overdue} overdue`);
  if (b.counts.week) parts.push(`${b.counts.week} due this week`);
  if (b.counts.needs) parts.push(`${b.counts.needs} ${b.counts.needs === 1 ? "needs" : "need"} a next step`);
  if (b.counts.quiet) parts.push(`${b.counts.quiet} quiet 14+ days`);
  const attention = parts.length ? parts.join(" · ") : "Nothing needs attention";
  return `${b.total} open · ${attention}`;
}
