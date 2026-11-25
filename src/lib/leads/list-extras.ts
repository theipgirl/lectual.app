import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadCustomColumns } from "@/lib/custom-columns/load";
import { withoutMoney, type CustomColumnsState } from "@/lib/custom-columns/rules";
import { readMergedChildren } from "@/lib/review/load";

/**
 * The one read the Leads List makes beyond the leads themselves: the firm's own columns (their fields and the values on the leads
 * shown, a lead also showing the newest value of a duplicate merged into it). It is the Weekly review's own read over the caller's
 * SCOPED client (RLS on the active firm); nothing here touches the service role. A firm with no live field costs one small read.
 *
 * Three states, never collapsed: `ok` / `not-set-up` / `unavailable`. A thrown error is "couldn't load", never "no firm columns".
 * Money is the owner's alone: `canSeeMoney` comes from the page's re-resolved role and no amount is read without it.
 */
export async function loadLeadListExtras(opts: { leadIds: readonly string[]; canSeeMoney: boolean }): Promise<CustomColumnsState> {
  try {
    const db = await getScopedClient();
    const r = await loadCustomColumns(db, [], [...new Set(opts.leadIds)], readMergedChildren as never, { canSeeMoney: opts.canSeeMoney });
    if (r.status !== "ok") return r;
    const state: CustomColumnsState = { ...r, leadOfMatter: {} };
    return opts.canSeeMoney ? state : withoutMoney(state);
  } catch {
    return { status: "unavailable" };
  }
}
