import type { QueueItem } from "@/lib/queue/api";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { classifyQueueItem, isAttorneyOnly, isOwnedBy, ROUTING_ADMIN_ROLES, type ApprovalRouting, type Viewer } from "@/lib/queue/routing";

export const STALE_DAYS = 7;
export const DISMISS_CAP = 50;
export const DISMISS_NOTE = "Dismissed: follow-up older than 7 days";

/**
 * The follow-ups "Dismiss follow-ups older than 7 days" may reject for this caller: pending, kind stalled follow-up,
 * not attorney-only (kind or legal-advice text), more than 7 days old, and owned by the caller (the admin tier owns all).
 */
export function dismissableFollowups(items: readonly QueueItem[], args: { routing: ApprovalRouting; viewer: Viewer | null; now: number }): QueueItem[] {
  const { routing, viewer, now } = args;
  if (!viewer || !QUEUE_EDIT_ROLES.includes(viewer.role)) return [];
  const admin = ROUTING_ADMIN_ROLES.includes(viewer.role);
  const cutoff = now - STALE_DAYS * 86_400_000;
  return items.filter((i) => {
    if (i.status !== "pending" || classifyQueueItem(i) !== "stalled_followup" || isAttorneyOnly(i)) return false;
    const queued = Date.parse(i.created_at);
    if (Number.isNaN(queued) || queued >= cutoff) return false;
    return admin || isOwnedBy(i, routing, viewer);
  });
}

export type DismissResult = { attempted: number; done: number; failed: number; remaining: number };

/** Rejects the eligible set, at most DISMISS_CAP, one failure never stopping the rest. */
export async function dismissStale(args: {
  items: readonly QueueItem[];
  routing: ApprovalRouting;
  viewer: Viewer | null;
  now: number;
  reject: (id: string, note: string) => Promise<void>;
}): Promise<DismissResult> {
  const eligible = dismissableFollowups(args.items, args);
  const batch = eligible.slice(0, DISMISS_CAP);
  let done = 0;
  let failed = 0;
  for (const item of batch) {
    try {
      await args.reject(item.id, DISMISS_NOTE);
      done += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: batch.length, done, failed, remaining: eligible.length - batch.length };
}
