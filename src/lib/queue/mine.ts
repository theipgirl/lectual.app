import type { QueueItem } from "@/lib/queue/api";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { isOwnedBy, type ApprovalRouting, type Viewer } from "@/lib/queue/routing";

/**
 * The pending items that count as the viewer's own, for Today's tile and the rail. A role that holds no work (viewer, social media)
 * keeps today's number (every pending item), and a routing read that failed (`routing` null) counts everything:
 * both fall back to the wider number, never to zero.
 */
export function mineItems(items: QueueItem[], routing: ApprovalRouting | null, viewer: Viewer | null): QueueItem[] {
  if (!routing || !viewer || !QUEUE_EDIT_ROLES.includes(viewer.role)) return items;
  return items.filter((i) => isOwnedBy(i, routing, viewer));
}
