/**
 * One row of the proposals table as the page shows it: every cell already worded. Pure
 * (a list item, the firm's civil date and zone, the newest events and names in; strings out),
 * so the table component is only markup and the cell rules are tested without a database.
 */

import { proposalDisplayStatus, proposalDisplayTone, type ProposalDisplayKey } from "./display-status";
import {
  expiresLabel,
  lastActivityLine,
  proposalHeadline,
  proposalRef,
  proposalSubline,
  type ActivityEvent,
} from "./list-labels";
import { paidMarker, type PaidMarker } from "./paid-view";
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
};

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
  /** The USPTO fees, due at filing. */
  atFilingCents: number;
  expires: string;
  activity: string;
  /** Accepted rows only: Paid / Not paid / Couldn't read, from the same `PaidState` the proposal page reads. Null on every other row. */
  paid: PaidMarker | null;
  /** Mark paid is offered: an accepted row that is read as not paid, for a role that may mark. Never while the read failed. */
  canMarkPaid: boolean;
};

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
  },
): ProposalRowView {
  const display = proposalDisplayStatus(item, { today: ctx.today, issues: item.blocking_issue });
  let paid: PaidMarker | null = null;
  let canMarkPaid = false;
  if (item.status === "accepted" && ctx.paid !== undefined) {
    const state = ctx.paid === "unavailable" ? "unreadable" : (ctx.paid.get(item.id) ?? ({ state: "not_paid", undoneAt: null } as const));
    paid = paidMarker(state, ctx.names, ctx.tz);
    canMarkPaid = !!ctx.canMarkPaid && paid.state === "not_paid";
  }
  const edited = item.package_basis && item.package_basis.edited.length > 0 ? item.package_basis.name : null;
  return {
    id: item.id,
    key: display.key,
    headline: proposalHeadline(item.title, item.brands),
    subline: proposalSubline({
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
    atFilingCents: item.gov_total_cents,
    expires: expiresLabel({ key: display.key, expiresOn: item.expires_on, acceptedAt: item.accepted_at, tz: ctx.tz }),
    activity: lastActivityLine({
      key: display.key,
      source: item.source,
      updatedAt: item.updated_at,
      acceptedAt: item.accepted_at,
      offeredCount: item.offered.length,
      blockingIssue: item.blocking_issue,
      event: ctx.events === "unavailable" ? "unavailable" : (ctx.events.get(item.id) ?? null),
      names: ctx.names,
      now: ctx.now,
    }),
    paid,
    canMarkPaid,
  };
}
