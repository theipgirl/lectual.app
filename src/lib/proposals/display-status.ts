import { isProposalExpired } from "./expiry";
import type { ProposalStatus } from "./types";

/**
 * The statuses the firm talks in, mapped onto `client_proposal` without a
 * schema change (spec B5.2):
 *
 *   draft, no approval-blocking issue   -> Draft
 *   approved                            -> Draft ("approved, ready to send")
 *   draft / approved with an issue      -> Blocked (sub-label: the first issue)
 *   sent, not past its expiry           -> Sent
 *   sent, past its expiry               -> Expired (derived here, never stored)
 *   accepted                            -> Accepted
 *   withdrawn / superseded              -> Closed
 *
 * Pure: the list read has no validation inputs of its own, so the caller hands
 * in the first approval-blocking message (`issues`), and `today` is the firm's
 * civil date, so no clock or time zone is read here.
 */

export const PROPOSAL_DISPLAY_KEYS = ["draft", "sent", "accepted", "expired", "blocked", "closed"] as const;
export type ProposalDisplayKey = (typeof PROPOSAL_DISPLAY_KEYS)[number];

export type ProposalDisplayStatus = {
  key: ProposalDisplayKey;
  label: string;
  /** Extra words under or beside the pill, or null. */
  sub: string | null;
};

export const PROPOSAL_DISPLAY_LABEL: Record<ProposalDisplayKey, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  expired: "Expired",
  blocked: "Blocked",
  closed: "Closed",
};

/** `lx-pill-*` tone: Blocked is risk, Expired is warn, Sent and Accepted are ok, Draft and Closed are mute. */
export function proposalDisplayTone(key: ProposalDisplayKey): "ok" | "warn" | "risk" | "mute" {
  switch (key) {
    case "blocked":
      return "risk";
    case "expired":
      return "warn";
    case "sent":
    case "accepted":
      return "ok";
    default:
      return "mute";
  }
}

export function isProposalDisplayKey(value: unknown): value is ProposalDisplayKey {
  return typeof value === "string" && (PROPOSAL_DISPLAY_KEYS as readonly string[]).includes(value);
}

/**
 * A `?status=` value as a display key. Stored statuses from older links still
 * work: approved reads as Draft, withdrawn and superseded as Closed. Anything
 * else is undefined (show All).
 */
export function parseDisplayFilter(value: unknown): ProposalDisplayKey | undefined {
  if (isProposalDisplayKey(value)) return value;
  if (value === "approved") return "draft";
  if (value === "withdrawn" || value === "superseded") return "closed";
  return undefined;
}

function make(key: ProposalDisplayKey, sub: string | null = null): ProposalDisplayStatus {
  return { key, label: PROPOSAL_DISPLAY_LABEL[key], sub };
}

export function proposalDisplayStatus(
  row: { status: ProposalStatus; expires_on: string | null },
  ctx: {
    /** The firm's civil date, "YYYY-MM-DD". */
    today: string;
    /** Approval-blocking messages for this row, first one first. Only read for draft and approved rows. */
    issues: readonly string[] | string | null | undefined;
  },
): ProposalDisplayStatus {
  const firstIssue = typeof ctx.issues === "string" ? ctx.issues : (ctx.issues?.[0] ?? null);
  switch (row.status) {
    case "draft":
      return firstIssue ? make("blocked", firstIssue) : make("draft");
    case "approved":
      return firstIssue ? make("blocked", firstIssue) : make("draft", "approved, ready to send");
    case "sent":
      // `today` is a civil date; noon UTC read in UTC is that same civil date.
      return isProposalExpired(row.expires_on, new Date(`${ctx.today}T12:00:00Z`), "UTC") ? make("expired") : make("sent");
    case "accepted":
      return make("accepted");
    default:
      return make("closed");
  }
}
