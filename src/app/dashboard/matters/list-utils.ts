// Ported verbatim from lectual src/app/(firm)/dashboard/matters/_components/list-utils.ts.

import type { Matter } from "@/lib/matters";
import { matterStatusOptions } from "@/lib/matters/status";

/** Pure — orders matters by opened_at desc (most recently opened first). Does not mutate input. */
export function sortByOpenedDate(matters: Matter[]): Matter[] {
  return [...matters].sort(
    (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
  );
}

/** Pure — filters to a single status. A falsy/"all" status is a no-op (returns all matters). */
export function filterByStatus(matters: Matter[], status?: string | null): Matter[] {
  if (!status || status === "all") return matters;
  return matters.filter((m) => m.status === status);
}

/**
 * Pure — the set of matter ids a pending approval-queue draft is tied to.
 *
 * Takes anything shaped like a queue row (so callers pass `QueueLoad.items`
 * without this module importing `@/lib/queue/api`'s server-only client type),
 * and drops rows with no `matter_id` — a queue draft can be lead-only or
 * matter-less, and those must not collapse into a false "needs review" match.
 */
export function matterIdsNeedingReview(
  items: ReadonlyArray<{ matter_id: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.matter_id) ids.add(item.matter_id);
  }
  return ids;
}

/**
 * Pure — filters to matters with a pending queue item tied to them.
 *
 * `reviewOnly` mirrors the other filters' query-param shape (a falsy/"0"/
 * "false" value is a no-op, same as `filterByStatus`'s "all"), so the page
 * can wire it straight off `searchParams.review` without a truthiness dance
 * at the call site.
 */
export function filterByReview(
  matters: Matter[],
  reviewIds: ReadonlySet<string>,
  reviewOnly?: string | null,
): Matter[] {
  if (!reviewOnly || reviewOnly === "0" || reviewOnly === "false") return matters;
  return matters.filter((m) => reviewIds.has(m.id));
}

/**
 * Pure — filters to matters that have gone quiet (past their stage's aging
 * threshold — the same set the ops home page's "Docket gone quiet" card
 * computes via `summarizeDocket`). `stalledOnly` mirrors the other filters'
 * query-param shape: a falsy/"0"/"false" value is a no-op.
 */
export function filterByStalled(
  matters: Matter[],
  stalledIds: ReadonlySet<string>,
  stalledOnly?: string | null,
): Matter[] {
  if (!stalledOnly || stalledOnly === "0" || stalledOnly === "false") return matters;
  return matters.filter((m) => stalledIds.has(m.id));
}

/**
 * Pure — the statuses the filter tabs offer.
 *
 * This used to be `distinct(matters.status)`, which meant the tab row was
 * whatever strings happened to exist: a firm with no closed matters had no
 * "Closed" tab, and a typo became a permanent tab. `status` now has a defined
 * vocabulary (src/lib/matters/status.ts, mirrored by 0035's
 * crm_matter_status_vocab CHECK), so the tabs are that vocabulary — stable
 * regardless of the data — plus any legacy value actually present, so a row
 * written before the vocabulary landed stays reachable.
 */
export function statusCatalog(matters: Matter[]): string[] {
  return matterStatusOptions(matters.map((m) => m.status));
}
