/**
 * The proposals list's left column: five segments over the display statuses, and the
 * "Out with clients" figure. Pure and client-safe (no `server-only`, no clock).
 *
 * Segments are views over `proposalDisplayStatus` keys (display-status.ts), never new
 * stored statuses:
 *
 *   Everything          every row, Closed included
 *   Out with a client   Sent (open, not past its expiry)
 *   Drafts and blocked  Draft and Blocked
 *   Accepted            Accepted
 *   Expired             Expired (derived)
 *
 * Closed (withdrawn / superseded) is listed under Everything only.
 */

import { defaultSelection, quoteProposal } from "./pricing";
import type { ProposalDisplayKey } from "./display-status";
import type { ProposalContent } from "./types";

export const PROPOSAL_SEGMENTS = ["everything", "out", "drafts", "accepted", "expired"] as const;
export type ProposalSegment = (typeof PROPOSAL_SEGMENTS)[number];

export const SEGMENT_LABEL: Record<ProposalSegment, string> = {
  everything: "Everything",
  out: "Out with a client",
  drafts: "Drafts and blocked",
  accepted: "Accepted",
  expired: "Expired",
};

/** The segment a row with this display status belongs to besides Everything; Closed is Everything only. */
export function segmentFor(key: ProposalDisplayKey): ProposalSegment {
  switch (key) {
    case "sent":
      return "out";
    case "draft":
    case "blocked":
      return "drafts";
    case "accepted":
      return "accepted";
    case "expired":
      return "expired";
    default:
      return "everything";
  }
}

/** Whether a row with this display status is listed under `segment`. */
export function inSegment(segment: ProposalSegment, key: ProposalDisplayKey): boolean {
  return segment === "everything" || segmentFor(key) === segment;
}

/**
 * A `?segment=` value, or an older `?status=` one so a bookmark keeps working
 * (draft, approved and blocked -> Drafts and blocked; sent -> Out with a client;
 * closed, withdrawn and superseded -> Everything). Anything else is undefined (Everything).
 */
export function parseSegment(value: unknown): ProposalSegment | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if ((PROPOSAL_SEGMENTS as readonly string[]).includes(v)) return v as ProposalSegment;
  switch (v) {
    case "draft":
    case "approved":
    case "blocked":
      return "drafts";
    case "sent":
      return "out";
    case "closed":
    case "withdrawn":
    case "superseded":
      return "everything";
    default:
      return undefined;
  }
}

export type OfferedPackage = {
  name: string;
  /** The legal fee at this package, due at signing, at the firm's pre-ticked offer. */
  legalAtSigningCents: number;
  /** The USPTO fees at this package, due at filing. Kept apart; never added to the legal fee. */
  usptoAtFilingCents: number;
};

/**
 * The packages a proposal offers. A proposal holds one package today (`pricing`), so this
 * is one entry when its name is not blank and none when it is (that row is Blocked by the
 * "Name the package." rule, which the list reads as "no package offered yet"). Total: a
 * malformed document offers nothing and never throws.
 */
export function offeredPackages(content: unknown): OfferedPackage[] {
  const c = content && typeof content === "object" && !Array.isArray(content) ? (content as Partial<ProposalContent>) : null;
  const pricing = c?.pricing && typeof c.pricing === "object" ? (c.pricing as unknown as Record<string, unknown>) : null;
  const name = typeof pricing?.package === "string" ? pricing.package.trim() : "";
  if (!c || !name) return [];
  const quote = quoteProposal(c as ProposalContent, defaultSelection(c as ProposalContent));
  return [{ name, legalAtSigningCents: quote.legal_total_cents, usptoAtFilingCents: quote.gov_total_cents }];
}

export type OutRow = { displayKey: ProposalDisplayKey; offered: readonly OfferedPackage[] };

export type OutWithClients = { status: "ok"; cents: number; count: number } | { status: "unavailable" };

/**
 * What is out with clients: over the Sent rows only (an Expired row is no longer open;
 * Draft, Blocked, Accepted and Closed were never or are no longer out), the CHEAPEST
 * offered package's legal fee at signing, summed. A USPTO fee is never part of it. A Sent
 * row that offers no package adds 0 and still counts in `count`. `null` is a proposals read
 * that failed: `unavailable`, never 0.
 */
export function outWithClientsCents(rows: readonly OutRow[] | null): OutWithClients {
  if (rows === null) return { status: "unavailable" };
  let cents = 0;
  let count = 0;
  for (const row of rows) {
    if (row.displayKey !== "sent") continue;
    count += 1;
    if (row.offered.length > 0) cents += Math.min(...row.offered.map((p) => p.legalAtSigningCents));
  }
  return { status: "ok", cents, count };
}
