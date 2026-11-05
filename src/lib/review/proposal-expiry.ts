import { addDays, daysBetween } from "./buckets";
import { shortDate } from "./format";

/**
 * Proposal-expiry tags for the weekly review. Pure: the loader passes what it read (no content, only
 * the expiry date), this decides the tag. Only the NEWEST version of each family counts, and only
 * while its status is `sent` (the link is live and not accepted). `expires_on` is a civil date, so
 * no time zone is involved: `today` is already the firm's calendar date.
 */

export type ProposalExpiryIn = {
  family_id: string;
  version: number;
  status: string;
  /** YYYY-MM-DD or null (no expiry set). */
  expires_on: string | null;
};

export type ProposalExpiryTag = {
  /** "Proposal expires Nov 4", "Proposal expires today" or "Proposal expired Oct 26". */
  text: string;
  /** YYYY-MM-DD. */
  expiresOn: string;
  expired: boolean;
};

/** An expired proposal still counts toward the KPI this long after its expiry. */
export const EXPIRED_WINDOW_DAYS = 14;

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** The newest version of each family, kept only when it is live (`sent`) with a real expiry date. */
export function livePendingProposals(proposals: readonly ProposalExpiryIn[]): { familyId: string; expiresOn: string }[] {
  const newest = new Map<string, ProposalExpiryIn>();
  for (const p of proposals) {
    const cur = newest.get(p.family_id);
    if (!cur || p.version > cur.version) newest.set(p.family_id, p);
  }
  const out: { familyId: string; expiresOn: string }[] = [];
  for (const p of newest.values()) {
    if (p.status === "sent" && p.expires_on && CIVIL.test(p.expires_on)) out.push({ familyId: p.family_id, expiresOn: p.expires_on });
  }
  return out;
}

/** The tag for one record: its earliest live expiry, or null when no live proposal has one. */
export function proposalExpiryTag(proposals: readonly ProposalExpiryIn[], today: string): ProposalExpiryTag | null {
  const live = livePendingProposals(proposals);
  if (live.length === 0) return null;
  const expiresOn = live.map((p) => p.expiresOn).sort()[0];
  if (expiresOn === today) return { text: "Proposal expires today", expiresOn, expired: false };
  if (expiresOn > today) return { text: `Proposal expires ${shortDate(expiresOn, today)}`, expiresOn, expired: false };
  return { text: `Proposal expired ${shortDate(expiresOn, today)}`, expiresOn, expired: true };
}

/** KPI rule: expires today through six days on, or expired within the last 14 days (and still sent). */
export function expiringThisWeek(tag: ProposalExpiryTag | null | undefined, today: string): boolean {
  if (!tag) return false;
  if (tag.expiresOn >= today) return tag.expiresOn <= addDays(today, 6);
  return daysBetween(tag.expiresOn, today) <= EXPIRED_WINDOW_DAYS;
}
