import type { LeadStepFacts, OpenTask, PendingDraft } from "./facts";
import { gapFor, type Gap } from "./gaps";
import { nextAction, type JobOffWhy, type NextPromise } from "./next-actions";
import { firmDate } from "./schedule";

/**
 * The ONE top card on a lead's page: the facts in, exactly one card out. No database and no server-only import
 * (tests/lead-step/hygiene.test.ts walks the import graph).
 *
 * PRECEDENCE (first that applies wins; tests/lead-step/decide.test.ts pins every row):
 *
 *   1  approvals read failed                         -> couldnt-load (what needs you)      never a confident card
 *   2  a pending client-facing draft for this lead   -> needs-yes (the oldest waiting)
 *   3  open next steps read failed                   -> couldnt-load (what needs you)
 *   4  an open next step overdue or due today        -> yours (due now)
 *   5  the approval queue isn't connected            -> approvals-off                      no promise, no gap
 *   6  a switched-on job will act                    -> has-it (what it waits for, what it does, when)
 *      a read that rule needs failed                 -> row 7 if there is a later step (with "couldn't show what
 *                                                       Lectual will do next" noted on it), else couldnt-load (next)
 *   7  an open next step due later or undated        -> yours (later)
 *   8  a step no assistant prepares yet              -> not-prepared (names the gap)
 *      a read that rule needs failed                 -> couldnt-load (what Lectual will do next)
 *   9  a job that could act here is off              -> quiet, with why and what a person does instead
 *  10  nothing                                       -> quiet
 *
 * Internal briefings (the consult heads-up, digests) are not a "yes" about this lead: they stay in Approvals. The
 * loader drops them and orders the rest oldest first BEFORE it caps how many it enriches, and `total` counts all.
 * A needs-yes card outranks a failed task read (row 2 before row 3): the draft is a real fact, and nothing
 * the task read could find ranks above it.
 */

export type DueState = "overdue" | "today" | "later" | "none";

export type TopCard =
  | { kind: "needs-yes"; item: PendingDraft; others: number }
  | { kind: "yours"; task: OpenTask; due: DueState; others: number; nextUnknown: boolean }
  | { kind: "has-it"; promise: NextPromise }
  | { kind: "not-prepared"; gap: Gap; off: { for: "consult-prep" | "post-consult"; why: JobOffWhy } | null }
  | { kind: "approvals-off" }
  | { kind: "quiet"; off: { for: "consult-prep" | "post-consult"; why: JobOffWhy } | null }
  | { kind: "couldnt-load"; what: "needs-you" | "next" };

/** Client-facing items first, oldest first; an internal briefing is never the card. The id breaks a tie. */
export function cardItems(items: readonly PendingDraft[]): PendingDraft[] {
  return items
    .filter((i) => i.kind !== "internal_briefing")
    .sort((a, b) => (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0) || a.id.localeCompare(b.id));
}

/** Due state on the firm's calendar. */
export function dueState(task: OpenTask, now: Date, timeZone: string): DueState {
  if (!task.dueAt || !Number.isFinite(Date.parse(task.dueAt))) return "none";
  const due = firmDate(task.dueAt, timeZone);
  const today = firmDate(now.getTime(), timeZone);
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "later";
}

/** Overdue first, then today, then by due date, undated last. */
export function orderTasks(tasks: readonly OpenTask[], now: Date, timeZone: string): OpenTask[] {
  const rank: Record<DueState, number> = { overdue: 0, today: 1, later: 2, none: 3 };
  return [...tasks].sort((a, b) => {
    const r = rank[dueState(a, now, timeZone)] - rank[dueState(b, now, timeZone)];
    if (r !== 0) return r;
    return (Date.parse(a.dueAt ?? "") || Infinity) - (Date.parse(b.dueAt ?? "") || Infinity) || a.id.localeCompare(b.id);
  });
}

export function decideTopCard(facts: LeadStepFacts): TopCard {
  const now = new Date(facts.now);

  // 1, 2
  if (facts.approvals.status === "unavailable") return { kind: "couldnt-load", what: "needs-you" };
  if (facts.approvals.status === "ok") {
    const items = cardItems(facts.approvals.value.items);
    const total = Math.max(facts.approvals.value.total, items.length);
    if (items.length > 0) return { kind: "needs-yes", item: items[0], others: total - 1 };
  }

  // 3, 4
  if (facts.tasks.status === "unavailable") return { kind: "couldnt-load", what: "needs-you" };
  const tasks = facts.tasks.status === "ok" ? orderTasks(facts.tasks.value, now, facts.timeZone) : [];
  const first = tasks[0];
  const firstDue = first ? dueState(first, now, facts.timeZone) : null;
  if (first && (firstDue === "overdue" || firstDue === "today")) return { kind: "yours", task: first, due: firstDue, others: tasks.length - 1, nextUnknown: false };

  // 5
  if (facts.approvals.status === "not-set-up") return { kind: "approvals-off" };

  // 6
  const next = nextAction(facts);
  if (next.status === "promise") return { kind: "has-it", promise: next.promise };
  // 7 (a known later step is never hidden behind a read that failed)
  if (first && firstDue) return { kind: "yours", task: first, due: firstDue, others: tasks.length - 1, nextUnknown: next.status === "unknown" };
  if (next.status === "unknown") return { kind: "couldnt-load", what: "next" };

  // 8
  const gap = gapFor(facts);
  if (gap.status === "unknown") return { kind: "couldnt-load", what: "next" };
  const off = next.status === "off" ? { for: next.for, why: next.why } : null;
  if (gap.status === "gap") return { kind: "not-prepared", gap: gap.gap, off };

  // 9, 10
  return { kind: "quiet", off };
}
