import "server-only";
import { listUpcomingDeadlines } from "@/lib/matters";
import { listProposalOpens, listProposals } from "@/lib/proposals/store";
import { ownerDeadlines, proposalsOut, OWNER_DEADLINE_DAYS, type OwnerDeadline, type OwnerProposal } from "@/lib/today/owner-rules";
import { civilInZone } from "@/lib/today/outcomes";
import { needsReviewItems, type NeedsReviewItem } from "@/lib/today/needs-review";

/**
 * The owner Today's own reads. Each one stands alone and is two-state (value / null): null means "couldn't be read",
 * which the card says in words. Scoped client only (the readers below use it); nothing is written.
 */
export async function loadOwnerDeadlines(now: Date, tz: string): Promise<OwnerDeadline[]> {
  // Overdue dates are included by the reader; the far end is bounded one day past the window to allow for time zones.
  const rows = await listUpcomingDeadlines({ withinDays: OWNER_DEADLINE_DAYS + 1, limit: 200 });
  return ownerDeadlines(rows, now, tz);
}

/** Old unconfirmed hand-entered dates, from the same deadline read (same call, same arguments) as the card above. */
export async function loadOwnerNeedsReview(now: Date, tz: string): Promise<NeedsReviewItem[]> {
  const rows = await listUpcomingDeadlines({ withinDays: OWNER_DEADLINE_DAYS + 1, limit: 200 });
  return needsReviewItems(rows, civilInZone(now, tz));
}

export async function loadOwnerProposals(now: Date, tz: string): Promise<OwnerProposal[]> {
  // latestOnly (the default) keeps each family's newest version; only a live one counts.
  const items = await listProposals({ limit: 300 });
  const out = proposalsOut(items, civilInZone(now, tz));
  // Opens are the `viewed` events the public page already writes (scoped read, no payload). Its own failure never fails
  // the card: each row then says "Couldn't load opens", never "not opened yet".
  try {
    const opens = await listProposalOpens(out.map((p) => p.id));
    return out.map((p) => ({ ...p, opens: opens.get(p.id)?.count ?? 0 }));
  } catch {
    return out.map((p) => ({ ...p, opens: "unavailable" as const }));
  }
}
