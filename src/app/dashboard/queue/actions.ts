"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveQueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { ROUTING_ADMIN_ROLES } from "@/lib/queue/routing";
import { requireFirmReviewer, ReviewerRefusal, runQueueReview } from "@/lib/queue/review-core";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { loadActiveQueue } from "@/lib/queue/load";
import { dismissStale, dismissableFollowups, type DismissResult } from "@/lib/queue/dismiss";
import type { Role } from "@/lib/auth/roles";

export type ReviewState = { error?: string };

/**
 * Approve / save / reject one queue item from the full approval page. A thin wrapper: every check lives in
 * `runQueueReview` (src/lib/queue/review-core.ts), which the approval deck calls too. Here the result becomes the
 * page's revalidate + redirect, exactly as before the split.
 */
export async function reviewQueueAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const body = formData.get("body");
  const outcome = await runQueueReview({
    id,
    intent,
    body: typeof body === "string" ? body : null,
    note: String(formData.get("note") ?? ""),
    confirmStale: formData.get("confirm_stale") === "yes",
  });
  if (outcome.kind === "error") return { error: outcome.error };
  if (outcome.kind === "saved") {
    revalidatePath(`/dashboard/queue/${id}/`);
    return {};
  }

  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  const sendParam = outcome.send ? `&send=${encodeURIComponent(outcome.send)}` : "";
  redirect(`/dashboard/queue/${id}/?resolved=${outcome.intent}${sendParam}`);
}

export type DismissState = { message?: string; error?: string };

/**
 * "Dismiss follow-ups older than 7 days": rejects the stale stalled-lead follow-ups the caller owns (any, for the
 * admin tier). The form posts a confirm flag and nothing else; the list is re-read and the eligible set chosen here.
 */
export async function dismissStaleFollowupsAction(_prev: DismissState, formData: FormData): Promise<DismissState> {
  if (formData.get("confirm") !== "yes") return { error: "Confirm first, then try again." };
  const qKey = await activeQueueOrgKey();
  if (!qKey) return { error: "No approval queue is configured for this firm." };

  let reviewer: { email: string; userId: string; role: Role };
  try {
    reviewer = await requireFirmReviewer(QUEUE_EDIT_ROLES, "dismiss");
  } catch (err) {
    return { error: err instanceof ReviewerRefusal ? err.message : "You must be signed in." };
  }

  const load = await loadActiveQueue("pending");
  if (load.status !== "ok") return { error: "The approval queue can't be reached right now, so nothing was dismissed. Refresh to try again." };
  const routed = await loadApprovalRouting();
  const routing = routed.status === "ok" ? routed.routing : {};
  const viewer = { userId: reviewer.userId, role: reviewer.role };

  // Stale follow-ups exist but none are this caller's: say so rather than "Nothing to dismiss."
  if (!ROUTING_ADMIN_ROLES.includes(reviewer.role)) {
    const now = Date.now();
    const exist = dismissableFollowups(load.items, { routing, viewer: { ...viewer, role: "owner" }, now });
    const mine = dismissableFollowups(load.items, { routing, viewer, now });
    if (exist.length > 0 && mine.length === 0) return { error: "These follow-ups are for someone else. Ask them, or an owner or admin." };
  }

  const result = await dismissStale({
    items: load.items,
    routing,
    viewer,
    now: Date.now(),
    reject: async (itemId, note) => {
      await resolveQueueItem({ orgKey: qKey, id: itemId, action: "reject", resolvedBy: reviewer.email, note });
    },
  });
  revalidatePath("/dashboard/queue/");
  return dismissMessage(result);
}

function dismissMessage(r: DismissResult): DismissState {
  const rest = r.remaining > 0 ? ` ${r.remaining} more are left. Run it again to clear them.` : "";
  if (r.attempted === 0) return { message: "Nothing to dismiss." };
  if (r.failed > 0) return { error: `Dismissed ${r.done}, ${r.failed} couldn't be dismissed. Refresh to try again.${rest}` };
  return { message: `Dismissed ${r.done} ${r.done === 1 ? "follow-up" : "follow-ups"}.${rest}` };
}
