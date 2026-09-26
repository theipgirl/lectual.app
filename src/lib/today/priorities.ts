import type { CalendarRow } from "@/lib/matters/calendar-rows";
import type { StalledMatter } from "@/lib/matters/docket-summary";
import { formatCivilDate } from "@/lib/matters/ip-fields";

/**
 * "Top of the list" on Today: the few things that need a person's judgment,
 * ranked. The weighting is lectual's ops-home "Top priorities" (overdue
 * deadlines, then the oldest drafts waiting, then what has gone quiet), with
 * two changes: stalled MATTERS stand in for stalled leads (a firm with a
 * docket and no leads saw nothing), and hot leads the triage agent flagged
 * that nobody has picked up yet get a slot. Pure, so the order is tested.
 */

export type PriorityTag = "overdue" | "deadline" | "approval" | "quiet" | "hot";

export type Priority = { key: string; href: string; tag: PriorityTag; title: string; detail: string | null; score: number };

export type PriorityInput = {
  deadlines: readonly CalendarRow[];
  queue: ReadonlyArray<{ id: string; headline: string; client_name: string | null; created_at: string }>;
  stalled: readonly StalledMatter[];
  hotLeads: ReadonlyArray<{ id: string; name: string; reason: string | null }>;
  now: Date;
};

const DAY = 86_400_000;

export function buildPriorities(input: PriorityInput, limit = 5): Priority[] {
  const pool: Priority[] = [];

  // Only dates inside two weeks compete; a date next quarter is not "today".
  input.deadlines.slice(0, 6).forEach((d, i) => {
    const soon = d.overdueDays > 0 || Date.parse(`${d.dueDate}T00:00:00Z`) - input.now.getTime() <= 14 * DAY;
    if (!soon) return;
    const where = d.source === "task" ? "Task" : d.detail;
    pool.push({
      key: `d-${d.key}`,
      href: d.href,
      tag: d.overdueDays > 0 ? "overdue" : "deadline",
      title: d.name,
      detail: d.overdueDays > 0 ? `${d.overdueDays}d overdue · ${where}` : `Due ${formatCivilDate(d.dueDate) ?? d.dueDate} · ${where}`,
      score: (d.overdueDays > 0 ? 1000 + d.overdueDays : 500) - i,
    });
  });

  input.queue.slice(0, 4).forEach((q, i) => {
    const ageDays = (input.now.getTime() - Date.parse(q.created_at)) / DAY;
    pool.push({
      key: `q-${q.id}`,
      href: `/dashboard/queue/${q.id}/`,
      tag: "approval",
      title: q.headline || "A draft is waiting for approval",
      detail: q.client_name ? `For ${q.client_name}` : null,
      score: 400 - i * 10 + (ageDays >= 3 ? 60 : ageDays >= 1 ? 25 : 0),
    });
  });

  input.hotLeads.slice(0, 2).forEach((l, i) => {
    pool.push({ key: `h-${l.id}`, href: `/dashboard/leads/${l.id}/`, tag: "hot", title: l.name, detail: l.reason, score: 350 - i });
  });

  input.stalled.slice(0, 3).forEach((m, i) => {
    pool.push({
      key: `s-${m.id}`,
      href: `/dashboard/matters/${m.id}/`,
      tag: "quiet",
      title: m.label,
      detail: `${m.daysInStage}d in ${m.stageLabel}`,
      score: 300 + Math.min(m.daysOverThreshold, 90) - i,
    });
  });

  return pool.sort((a, b) => b.score - a.score).slice(0, limit);
}
