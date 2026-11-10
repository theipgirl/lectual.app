/**
 * One row of the proposals table as the page shows it: every cell already worded. Pure
 * (a list item, the firm's civil date and zone, the newest events and names in; strings out),
 * so the table component is only markup and the cell rules are tested without a database.
 */

import { opensKind, opensListText, type OpensKind, type OpensRead } from "./opens";
import { proposalDisplayStatus, proposalDisplayTone, type ProposalDisplayKey } from "./display-status";
import {
  expiresLabel,
  compactAgo,
  lastActivityLine,
  proposalHeadline,
  proposalRef,
  proposalSubline,
  type ActivityEvent,
} from "./list-labels";
import { formatShortFirmDate } from "@/lib/quotes/labels";
import { paidLine, paidMarker, type PaidMarker } from "./paid-view";
import type { PaidState } from "./paid";
import type { OfferedPackage } from "./segments";
import type { ProposalPackageBasis, ProposalSource, ProposalStatus } from "./types";

export type ListRowInput = {
  id: string;
  family_id: string;
  version: number;
  client_name: string;
  title: string;
  status: ProposalStatus;
  source: ProposalSource;
  expires_on: string | null;
  accepted_at: string | null;
  updated_at: string;
  legal_total_cents: number;
  gov_total_cents: number;
  blocking_issue: string | null;
  brands: readonly string[];
  offered: readonly OfferedPackage[];
  class_count: number;
  signed_package: string | null;
  package_basis: ProposalPackageBasis | null;
  /** Spec 9: set (non-empty) only on a general (flat-fee) proposal. Absent or null = trademark. */
  matter_title?: string | null;
};

/**
 * The Paid cell of a row (Sprint 29). Four states, never three: "—" for a row that is not accepted, "Paid <date>" (with
 * Undo for the roles that may), "Not paid" (with Mark paid for them) and "Paid status couldn't be read", which is never
 * "Not paid" and offers no button.
 *
 * PAID IS STILL BY HAND. Mark paid here is the same action the proposal page has, and it is a stopgap: it records that
 * a person confirmed the payment in Lawmatics. Once the firm's LawPay connection takes payment on the proposal, the paid
 * state comes from that payment and this button goes away (the state itself stays derived from events, `paid.ts`).
 */
export type PaidCellView =
  | { kind: "none"; text: string }
  | { kind: "paid"; text: string; /** "Paid · marked by Dawn · Oct 21": who and when, as the tooltip. */ title: string; canUndo: boolean }
  | { kind: "not_paid"; text: string; canMark: boolean }
  | { kind: "unreadable"; text: string };

/** Shown beside Mark paid. */
export const MARK_PAID_NOTE = "Mark paid after you've confirmed the payment in Lawmatics.";
export const PAID_UNREADABLE_TEXT = "Paid status couldn't be read";

export type ProposalRowView = {
  id: string;
  key: ProposalDisplayKey;
  headline: string;
  subline: string;
  client: string;
  statusLabel: string;
  statusTone: "ok" | "warn" | "risk" | "mute";
  /** The sub-label under the pill ("approved, ready to send"), or null. */
  statusSub: string | null;
  /** The legal fee, due at signing. A figure of its own: it is never added to the USPTO fees. */
  atSigningCents: number;
  /** The USPTO fees, due at filing. Null on a general (flat-fee) proposal, which has none: the list shows "—". */
  atFilingCents: number | null;
  expires: string;
  activity: string;
  /**
   * The quiet third line of the Proposal cell: `activity`, except on a Blocked row, whose reason is already in the Status
   * cell and so is said once: it reads "Updated 5d ago" there.
   */
  activityLine: string;
  /** Accepted rows only: Paid / Not paid / Couldn't read, from the same `PaidState` the proposal page reads. Null on every other row. */
  paid: PaidMarker | null;
  /** Mark paid is offered: an accepted row that is read as not paid, for a role that may mark. Never while the read failed. */
  canMarkPaid: boolean;
  /** The Accepted column: "Accepted Oct 21", or "Not yet". */
  accepted: string;
  /** The Paid column (see `PaidCellView`). */
  paidCell: PaidCellView;
  /** Spec 7: "Opened Oct 29, 3:12 PM · 4 times" / "Not opened yet" / "Couldn't load opens" / "—". Absent when not asked. */
  opens?: { kind: OpensKind; text: string };
};

/** Where a row sits in "accepted, not paid first". Lower sorts earlier. */
const PAID_RANK: Record<PaidCellView["kind"], number> = { not_paid: 0, unreadable: 1, paid: 2, none: 3 };

/** The rows in the order a segment shows them. The Accepted segment lists accepted-and-not-paid first; the others keep the list's order. Stable. */
export function sortForSegment<T extends Pick<ProposalRowView, "paidCell">>(segment: string, rows: readonly T[]): T[] {
  if (segment !== "accepted") return [...rows];
  return rows.map((row, index) => ({ row, index })).sort((a, b) => PAID_RANK[a.row.paidCell.kind] - PAID_RANK[b.row.paidCell.kind] || a.index - b.index).map((x) => x.row);
}

/** The title a proposal is created with (New proposal, the consult drafter, the client page). In the LIST only, a row with this title is named by its brand names. */
export const DEFAULT_PROPOSAL_TITLE = "Trademark Proposal";

/** The brand names as a list headline: the first two uppercased and joined with " & ", then "+N" for the rest. */
function brandHeadline(brands: readonly string[]): string {
  const names = brands.map((b) => b.trim().toUpperCase()).filter(Boolean);
  const shown = names.slice(0, 2).join(" & ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

export function buildProposalRowView(
  item: ListRowInput,
  ctx: {
    /** The firm's civil date, "YYYY-MM-DD". */
    today: string;
    tz: string;
    now: number;
    /** Newest event per proposal id, or "unavailable" when that read failed. */
    events: ReadonlyMap<string, ActivityEvent> | "unavailable";
    names: ReadonlyMap<string, string>;
    /** Sprint 19: each accepted row's paid state, or "unavailable" when that read failed. Absent = not asked (no paid column). */
    paid?: ReadonlyMap<string, PaidState> | "unavailable";
    /** Owner / admin / senior admin / intake. */
    canMarkPaid?: boolean;
    /** Spec 7: the client's opens per version, or "unavailable" when that read failed. Absent = not asked (no line). */
    opens?: OpensRead;
  },
): ProposalRowView {
  const display = proposalDisplayStatus(item, { today: ctx.today, issues: item.blocking_issue });
  let paid: PaidMarker | null = null;
  let canMarkPaid = false;
  let paidCell: PaidCellView = { kind: "none", text: "—" };
  if (item.status === "accepted" && ctx.paid !== undefined) {
    const state = ctx.paid === "unavailable" ? "unreadable" : (ctx.paid.get(item.id) ?? ({ state: "not_paid", undoneAt: null } as const));
    paid = paidMarker(state, ctx.names, ctx.tz);
    canMarkPaid = !!ctx.canMarkPaid && paid.state === "not_paid";
    if (state === "unreadable") paidCell = { kind: "unreadable", text: PAID_UNREADABLE_TEXT };
    else if (state.state === "paid") {
      const when = formatShortFirmDate(state.at, ctx.tz);
      paidCell = { kind: "paid", text: when ? `Paid ${when}` : "Paid", title: paidLine(state, ctx.names, ctx.tz), canUndo: !!ctx.canMarkPaid };
    } else paidCell = { kind: "not_paid", text: "Not paid", canMark: canMarkPaid };
  }
  const acceptedWhen = item.accepted_at ? formatShortFirmDate(item.accepted_at, ctx.tz) : "";
  const accepted = item.status === "accepted" || item.accepted_at ? (acceptedWhen ? `Accepted ${acceptedWhen}` : "Accepted") : "Not yet";
  const edited = item.package_basis && item.package_basis.edited.length > 0 ? item.package_basis.name : null;
  // Spec 9: a general (flat-fee) proposal is named by its matter, has one flat fee and no USPTO fee.
  const matterTitle = typeof item.matter_title === "string" && item.matter_title.trim() ? item.matter_title.trim() : null;
  // Display only, never stored: a default-titled trademark proposal with brand names reads as its brand names, with the type in the sub-line.
  const byBrand = !matterTitle && item.title.trim().toLowerCase() === DEFAULT_PROPOSAL_TITLE.toLowerCase() && brandHeadline(item.brands) !== "";
  const activity = lastActivityLine({
    key: display.key,
    source: item.source,
    updatedAt: item.updated_at,
    acceptedAt: item.accepted_at,
    offeredCount: item.offered.length,
    blockingIssue: item.blocking_issue,
    event: ctx.events === "unavailable" ? "unavailable" : (ctx.events.get(item.id) ?? null),
    names: ctx.names,
    now: ctx.now,
  });
  const updatedAgo = compactAgo(item.updated_at, ctx.now);
  return {
    id: item.id,
    key: display.key,
    headline: matterTitle ? `${item.title} — ${matterTitle}` : byBrand ? brandHeadline(item.brands) : proposalHeadline(item.title, item.brands),
    subline: matterTitle
      ? `${proposalRef(item.family_id, item.version)} · Flat fee`
      : (byBrand ? "Trademark proposal · " : "") + proposalSubline({
          ref: proposalRef(item.family_id, item.version),
          key: display.key,
          offeredCount: item.offered.length,
          signedPackage: item.signed_package,
          classCount: item.class_count,
          editedFrom: edited,
        }),
    client: item.client_name,
    statusLabel: display.label,
    statusTone: proposalDisplayTone(display.key),
    statusSub: display.sub,
    atSigningCents: item.legal_total_cents,
    atFilingCents: matterTitle ? null : item.gov_total_cents,
    expires: expiresLabel({ key: display.key, expiresOn: item.expires_on, acceptedAt: item.accepted_at, tz: ctx.tz }),
    activity,
    activityLine: display.key === "blocked" ? (updatedAgo ? `Updated ${updatedAgo}` : "Updated") : activity,
    paid,
    canMarkPaid,
    accepted,
    paidCell,
    ...(ctx.opens !== undefined
      ? { opens: { kind: opensKind(item.status, ctx.opens, item.id), text: opensListText(item.status, ctx.opens, item.id, ctx.tz) } }
      : {}),
  };
}
