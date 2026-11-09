import type { ReviewRow } from "./buckets";
import { WAITING_LABEL } from "./waiting";
import { deadlineIsSoon, shortDate } from "./format";

export type ReviewTag = { text: string; tone: "warn" | "risk" | null };

/** Every tag a row carries, in a fixed order. Pure. */
export function rowTags(row: ReviewRow, today: string): ReviewTag[] {
  const tags: ReviewTag[] = [];
  if (row.waiting) tags.push({ text: `Waiting on ${WAITING_LABEL[row.waiting]}`, tone: row.waiting === "approval" ? "warn" : null });
  if (row.deadline) tags.push({ text: `USPTO deadline ${shortDate(row.deadline.dueDate, today)}`, tone: deadlineIsSoon(row.deadline.dueDate, today) ? "risk" : null });
  if (row.proposalExpiry) tags.push({ text: row.proposalExpiry.text, tone: row.proposalExpiry.expired ? "risk" : null });
  return tags;
}

/** At most `max` tags, and how many were left out (drawn as "+N"). */
export function limitTags(tags: readonly ReviewTag[], max = 2): { shown: ReviewTag[]; more: number } {
  return { shown: tags.slice(0, max), more: Math.max(0, tags.length - max) };
}
