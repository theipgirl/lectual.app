import "server-only";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import type { ApprovalRouting, RoutingMember, Viewer } from "@/lib/queue/routing";

export type QueueViewContext = {
  viewer: Viewer | null;
  routing: ApprovalRouting;
  /** null = the member list could not be read */
  members: RoutingMember[] | null;
  routingFailed: boolean;
  /** Entries in the stored routing that no longer name a valid member or kind. */
  dropped: number;
  /** The request's clock, read here so a page never calls Date.now() while rendering. */
  now: number;
};

/** Who is looking, and the routing, for the Approvals pages. Reads fail to the default rule, never to a wider one. */
export async function loadQueueViewContext(): Promise<QueueViewContext> {
  const [session, routed] = await Promise.all([resolveFirmSession().catch(() => null), loadApprovalRouting()]);
  const viewer = session && session.kind === "ok" ? { userId: session.user.id, role: session.role } : null;
  return routed.status === "ok"
    ? { viewer, routing: routed.routing, members: routed.members, routingFailed: false, dropped: routed.dropped, now: Date.now() }
    : { viewer, routing: {}, members: null, routingFailed: true, dropped: 0, now: Date.now() };
}
