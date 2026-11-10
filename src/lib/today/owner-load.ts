import "server-only";
import { listUpcomingDeadlines } from "@/lib/matters";
import { listProposals } from "@/lib/proposals/store";
import { ownerDeadlines, proposalsOut, OWNER_DEADLINE_DAYS, type OwnerDeadline, type OwnerProposal } from "@/lib/today/owner-rules";
import { civilInZone } from "@/lib/today/outcomes";

/**
 * The owner Today's own reads. Each one stands alone and is two-state (value / null): null means "couldn't be read",
 * which the card says in words. Scoped client only (the readers below use it); nothing is written.
 */
export async function loadOwnerDeadlines(now: Date, tz: string): Promise<OwnerDeadline[]> {
  // Overdue dates are included by the reader; the far end is bounded one day past the window to allow for time zones.
  const rows = await listUpcomingDeadlines({ withinDays: OWNER_DEADLINE_DAYS + 1, limit: 200 });
  return ownerDeadlines(rows, now, tz);
}

export async function loadOwnerProposals(now: Date, tz: string): Promise<OwnerProposal[]> {
  // latestOnly (the default) keeps each family's newest version; only a live one counts.
  const items = await listProposals({ limit: 300 });
  return proposalsOut(items, civilInZone(now, tz));
}
