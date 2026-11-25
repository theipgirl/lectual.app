/**
 * The staff proposal page's "Due today $X · Balance $Y" line. PURE. From the draft's own terms and its saved quote, or, for an
 * accepted version, from the snapshot: its recorded `due_now_cents` when present (older snapshots have none, and then the line
 * is worked out from the snapshot's terms and quote, never from a later edit).
 */

import { formatDollars } from "@/lib/proposal-editor/events";
import { dueTodayStaffLine } from "@/lib/proposal-editor/vocabulary";
import { activePaymentTerms, dueToday } from "./due-today";
import type { AcceptedSnapshot, ProposalContent, ProposalQuote } from "./types";

export function staffDueTodayLine(content: Pick<ProposalContent, "payment_terms">, quote: Pick<ProposalQuote, "legal_total_cents">): string | null {
  const terms = activePaymentTerms(content);
  if (!terms) return null;
  const split = dueToday(quote, terms);
  return dueTodayStaffLine(formatDollars(split.due_now_cents), formatDollars(split.balance_cents));
}

export function acceptedDueToday(snapshot: Partial<AcceptedSnapshot> | null | undefined): string | null {
  if (!snapshot || !snapshot.quote) return null;
  const terms = activePaymentTerms({ payment_terms: snapshot.payment_terms ?? snapshot.content?.payment_terms });
  if (!terms) return null;
  const total = Number.isFinite(snapshot.quote.legal_total_cents) ? snapshot.quote.legal_total_cents : 0;
  const recorded = typeof snapshot.due_now_cents === "number" && Number.isInteger(snapshot.due_now_cents) ? snapshot.due_now_cents : null;
  const dueNow = recorded ?? dueToday(snapshot.quote, terms).due_now_cents;
  return dueTodayStaffLine(formatDollars(dueNow), formatDollars(total - dueNow));
}
