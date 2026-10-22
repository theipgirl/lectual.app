import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { StopDb } from "@/lib/campaigns/stop-db";
import type { LeadPendingApproval, LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import type { QueueItem } from "./api";
import { loadActiveQueue, type QueueLoad } from "./load";
import { resolveBatch } from "./resolve-batch";
import { isClientFacing } from "./stale";

/**
 * Pending approvals grouped by lead — what the intake view and the lead page
 * show as "waiting on Rebecca" without a trip to the queue board.
 *
 * The queue is another service and its rows carry no lead id, so each pending
 * item is tied to its lead(s) by the SAME rules, in the SAME order, as the
 * approval-time stale check (`resolveLeads` in stale.ts): the `queue_drafted`
 * timeline row the drafter wrote, else the item's matter, else an exact
 * recipient-address match. Here they run BATCHED — one `.in(...)` query per
 * rule for every pending item at once — because the intake page asks about the
 * whole queue, not one item. An item none of the rules resolves belongs to no
 * lead and is simply not listed under one; it still shows on the queue board.
 *
 * THREE-STATE, never two (AGENTS.md): a queue we could not read is
 * `unavailable`, and so is a queue we read but could not map to leads. Neither
 * may ever look like `ok` with nothing pending. Reads go through the caller's
 * scoped client only.
 */

function kindOf(item: QueueItem, payloadKind: string | null): LeadPendingApproval["kind"] {
  if (payloadKind === "heads_up") return "rebecca_brief";
  if (payloadKind === "client_prep" || isClientFacing(item)) return "client_draft";
  return "other";
}

/** Group pending items by the leads they belong to, newest first within a lead. Exported for tests. */
export async function groupPendingByLead(db: StopDb, items: QueueItem[]): Promise<Record<string, LeadPendingApproval[]>> {
  const byLead: Record<string, LeadPendingApproval[]> = {};
  if (items.length === 0) return byLead;
  const resolved = await resolveBatch(db, items);
  for (const item of items) {
    const hit = resolved.get(item.id);
    if (!hit) continue;
    const approval: LeadPendingApproval = {
      queueId: item.id,
      headline: item.headline?.trim() || item.subject?.trim() || "Untitled draft",
      kind: kindOf(item, hit.kind),
      createdAt: item.created_at || null,
    };
    for (const leadId of hit.leadIds) (byLead[leadId] ??= []).push(approval);
  }
  for (const list of Object.values(byLead)) {
    list.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0);
  }
  return byLead;
}

/**
 * Never throws: an outage must not take the intake page or the lead page down,
 * and it is reported as `unavailable` rather than as an empty map. `deps` is
 * injectable for tests; production uses the active org's queue and the
 * caller's scoped client.
 */
export async function loadPendingApprovalsByLead(
  deps: { load?: () => Promise<QueueLoad>; db?: StopDb } = {},
): Promise<LeadPendingApprovals> {
  const queue = await (deps.load ?? (() => loadActiveQueue("pending")))();
  if (queue.status === "unconfigured") return { status: "unconfigured" };
  if (queue.status === "unavailable") return { status: "unavailable" };
  try {
    const db = deps.db ?? ((await getScopedClient()) as unknown as StopDb);
    return { status: "ok", byLead: await groupPendingByLead(db, queue.items) };
  } catch (error) {
    console.error("[queue] could not map pending approvals to leads:", error);
    return { status: "unavailable" };
  }
}
