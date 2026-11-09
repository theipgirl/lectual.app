import type { ReviewRow } from "./buckets";
import { shortDate } from "./format";
import type { LaneMember } from "./lanes";

/**
 * The two strips above the Board: proposals that are out, and what is waiting on the review person. Pure.
 * Both read only what the loader already has (`proposalExpiry`, next-step assignee, `waiting`).
 */

export type ProposalOut = { row: ReviewRow; /** "Last day Nov 11", "Last day today" or "Expired Nov 5". */ text: string; expired: boolean; expiresOn: string };

/** Every row with a live proposal expiry, soonest last day first (expired ones first of all). */
export function proposalsOut(rows: readonly ReviewRow[], today: string): ProposalOut[] {
  const out: ProposalOut[] = [];
  for (const row of rows) {
    const tag = row.proposalExpiry;
    if (!tag) continue;
    const text = tag.expired ? `Expired ${shortDate(tag.expiresOn, today)}` : tag.expiresOn === today ? "Last day today" : `Last day ${shortDate(tag.expiresOn, today)}`;
    out.push({ row, text, expired: tag.expired, expiresOn: tag.expiresOn });
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.row.client.localeCompare(b.row.client, "en") || a.row.key.localeCompare(b.row.key));
}

/** The member whose display name starts with "Rebecca", or null (the strip is then hidden). */
export function reviewPerson(members: readonly LaneMember[]): { userId: string; name: string; firstName: string } | null {
  const m = members.find((x) => /^rebecca\b/i.test(x.name.trim()));
  return m ? { userId: m.userId, name: m.name, firstName: m.name.trim().split(/\s+/)[0] } : null;
}

/** Rows whose next step is assigned to the person, plus every row waiting on an approval, each once, by client. */
export function waitingOnPerson(rows: readonly ReviewRow[], personId: string): ReviewRow[] {
  return rows
    .filter((r) => r.nextStep?.assigneeId === personId || r.waiting === "approval")
    .sort((a, b) => a.client.localeCompare(b.client, "en") || a.key.localeCompare(b.key));
}
