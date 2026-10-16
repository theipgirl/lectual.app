import "server-only";
import { listQueue, type QueueItem } from "./api";
import { activeQueueOrgKey } from "./org";

/**
 * Why this module exists — read before "simplifying" it.
 *
 * The approval queue is a separate deployed service (lawmatics-mcp) reached
 * over HTTP. It can be unreachable, and a firm may have no queue wired up at
 * all. Neither of those is an empty queue, and collapsing them into one is
 * the single most dangerous bug this product can ship:
 *
 *   Lectual's whole promise is that nothing reaches a client without a human
 *   approving it. A surface that says "All caught up — nothing is waiting for
 *   review" when the queue is actually DOWN tells a firm there is nothing to
 *   approve while real drafts sit unseen. The reassuring message is the
 *   failure.
 *
 * So a load returns one of three states, never a bare array:
 *
 *   ok            — we reached the queue; `items` is the truth
 *   unconfigured  — this org has no queue key; there is no queue to be caught
 *                   up with
 *   unavailable   — the queue exists but we could not reach it; we do not
 *                   know what is waiting
 *
 * The firm shell (src/app/(firm)/layout.tsx) already carried this three-state
 * logic for the nav bell. Every other surface re-implemented a two-state
 * version of it and got it wrong. This is that logic, extracted, so there is
 * one copy to be right.
 */

export type QueueLoadStatus = "ok" | "unconfigured" | "unavailable";

/**
 * WHY there is no queue, when `status === 'unconfigured'`.
 *
 * Both reasons produce the same (empty, untrustworthy) contents, but they are
 * different situations for different people, and one message for both sent the
 * wrong firm chasing the wrong fix:
 *
 *   'org-key' — this firm has no `crm_org.queue_org_key`. Approvals simply
 *               aren't turned on for them yet. Nothing is broken and there is
 *               no env var anyone can set to change it — it is a per-tenant
 *               setup step. Cabanis Law is exactly this. Telling them to "ask
 *               an admin to set QUEUE_API_URL" is advice for a problem they do
 *               not have.
 *   'env'     — the DEPLOYMENT has no QUEUE_API_URL/DASHBOARD_API_TOKEN (the
 *               "not configured" error raised by @/lib/queue/api's config()).
 *               That one really is an admin/env fix, and firms that DO have a
 *               queue key are affected by it.
 */
export type QueueUnconfiguredReason = "org-key" | "env";

export type QueueLoad = {
  status: QueueLoadStatus;
  /** Empty for every status except `ok` — never mistake it for "nothing pending". */
  items: QueueItem[];
  /** Only set when `status === 'unconfigured'`. */
  reason?: QueueUnconfiguredReason;
  /** Only set when `status === 'unavailable'` (or the 'env' unconfigured case). */
  error?: unknown;
};

/**
 * Distinguishes "this deployment has no QUEUE_API_URL/DASHBOARD_API_TOKEN"
 * (raised by @/lib/queue/api's config()) from a real outage. Both mean we
 * have no queue contents, but only one of them is fixed by waiting — so they
 * must not share a message. Mirrors the predicate the queue tab's format.tsx
 * uses for the same purpose.
 */
function isNotConfiguredError(err: unknown): boolean {
  return err instanceof Error && /not configured/i.test(err.message);
}

/** True only when we actually reached the queue and it was genuinely empty. */
export function isGenuinelyEmpty(load: QueueLoad): boolean {
  return load.status === "ok" && load.items.length === 0;
}

/**
 * Pending count safe to render as a number. Returns null for the two states
 * where a number would be a lie — callers must render those as their own
 * thing ("not connected" / "can't reach the queue"), not as 0.
 */
export function pendingCountOrNull(load: QueueLoad): number | null {
  return load.status === "ok" ? load.items.length : null;
}

/**
 * Loads the active org's queue into the three-state shape above.
 *
 * Never throws: a queue outage must not break the page it appears on. The
 * failure is carried in the return value instead, and logged server-side with
 * a greppable prefix so an outage stays diagnosable rather than invisible.
 */
export async function loadActiveQueue(
  status: QueueItem["status"] = "pending",
): Promise<QueueLoad> {
  try {
    const orgKey = await activeQueueOrgKey();
    if (!orgKey) return { status: "unconfigured", reason: "org-key", items: [] };
    return { status: "ok", items: await listQueue(orgKey, status) };
  } catch (error) {
    // A missing deployment config is not an outage — same "there is no queue
    // here" state as an org with no queue key, and no point logging it as a
    // failure on every render.
    if (isNotConfiguredError(error))
      return { status: "unconfigured", reason: "env", items: [], error };
    // Server-side breadcrumb: an outage should be diagnosable, not invisible.
    console.error("[queue] approval queue unreachable:", error);
    return { status: "unavailable", items: [], error };
  }
}
