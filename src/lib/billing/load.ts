import "server-only";

import { firmLawmaticsClient, LawmaticsNotConnectedError } from "@/lib/lawmatics/connection";
import type { FetchLike, LawmaticsClient } from "@/lib/lawmatics/client";
import { withTimeout } from "@/lib/http/timeout";
import { invoiceTotals, normalizeInvoices, type BillingRead } from "./invoices";

/** One deadline for the whole read, per request. */
export const BILLING_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RECORDS = 1000;

export type BillingDeps = { getClient?: () => Promise<LawmaticsClient> };

/**
 * A matter's invoices, read LIVE from the firm's own Lawmatics (signed-in, active connection only; never a
 * deployment token). Read-only and nothing is stored. Three-state at least: every failure is a named state,
 * never an empty list. Nothing about an invoice is logged; a failure logs an error NAME only.
 *
 * The caller (the owner-only card) has already decided the viewer may see billing.
 */
export async function loadMatterInvoices(lawmaticsId: string | null | undefined, deps: BillingDeps = {}): Promise<BillingRead> {
  const id = typeof lawmaticsId === "string" ? lawmaticsId.trim() : "";
  if (!id) return { status: "not-linked" };

  try {
    // One deadline for the whole sweep: every page shares the same signal.
    const deadline = AbortSignal.timeout(BILLING_TIMEOUT_MS);
    const timedFetch = ((input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
      fetch(input, withTimeout({ ...init, signal: deadline }, BILLING_TIMEOUT_MS))) as unknown as FetchLike;
    const getClient = deps.getClient ?? (() => firmLawmaticsClient(timedFetch));
    const client = await getClient();
    const list = await client.listAll("/invoices", {
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
      maxRecords: MAX_RECORDS,
      params: { filter_by: "prospect_id", filter_on: id },
    });
    if (list.unrecognisedShape) return { status: "unavailable" };

    // The filter is never trusted: keep only invoices that name this matter.
    const invoices = normalizeInvoices(list.records, id);
    const totals = invoiceTotals(invoices);
    return { status: list.truncated ? "cut-short" : "ok", invoices, totals };
  } catch (err) {
    if (err instanceof LawmaticsNotConnectedError) {
      // "Not switched on" and "rejected token" are both fixed in Integrations.
      return { status: "not-connected" };
    }
    console.error("[billing] invoices read failed", err instanceof Error ? err.name : "error");
    return { status: "unavailable" };
  }
}
