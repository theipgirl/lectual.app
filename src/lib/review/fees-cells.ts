import { latestFeeEntries, type FeeLedger } from "@/lib/matters/fees";
import { formatCents } from "@/lib/quotes/money";
import { proposalsCount } from "@/lib/ui/words";
import type { FeeCell, ReviewFees } from "./buckets";

/**
 * Turns what the two fee reads returned into one record's `ReviewFees`. Pure: no database, no client. Owner-only money; the loader
 * only runs the reads (and so only calls this) when the page said the viewer may see it.
 *
 * Rules: the newest ACCEPTED proposal of the record wins over the spreadsheet ledger (a lead-filed proposal shows on the matter row);
 * proposal money goes through `formatCents`, the ledger's amounts and due dates stay verbatim strings; the due dates come from the
 * ledger only (a proposal carries none, so a proposal with no ledger row reads no date); nothing is added up or balanced.
 */

/** One accepted proposal as the fee read returns it: ids, the accept time, and the two quote totals. Nothing else of the proposal. */
export type AcceptedFeeRow = {
  id: string;
  family_id: string;
  version: number;
  lead_id: string | null;
  matter_id: string | null;
  accepted_at: string | null;
  legal: unknown;
  gov: unknown;
};

/** One tracker ledger row as the fee read returns it: the matter, when it was written, and only the fields the fee cells use. */
export type TrackerFeeRow = { matter_id: string | null; created_at: string | null; kind: string | null; total: string | null; due: string | null };

const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function newer(a: AcceptedFeeRow, b: AcceptedFeeRow): boolean {
  const at = a.accepted_at ? Date.parse(a.accepted_at) : Number.NEGATIVE_INFINITY;
  const bt = b.accepted_at ? Date.parse(b.accepted_at) : Number.NEGATIVE_INFINITY;
  if (at !== bt) return (Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at) > (Number.isNaN(bt) ? Number.NEGATIVE_INFINITY : bt);
  return a.version !== b.version ? a.version > b.version : a.id > b.id;
}

/** The accepted proposals that belong to a record: a matter's own, and those filed on its lead; a lead's own. */
export function proposalsOfRecord(row: { kind: "matter" | "lead"; id: string }, leadIdOfMatter: string | null, all: readonly AcceptedFeeRow[]): AcceptedFeeRow[] {
  if (row.kind === "lead") return all.filter((p) => p.lead_id === row.id);
  return all.filter((p) => p.matter_id === row.id || (leadIdOfMatter !== null && p.lead_id === leadIdOfMatter));
}

function proposalCell(winner: AcceptedFeeRow | null, field: "legal" | "gov", families: number): FeeCell {
  const value = winner ? cents(winner[field]) : null;
  if (value === null) return null;
  return { text: families > 1 ? `${formatCents(value)} · ${proposalsCount(families)}` : formatCents(value), from: "proposal" };
}

function ledgerOf(rows: readonly TrackerFeeRow[]): FeeLedger {
  return latestFeeEntries(rows.map((r) => ({ created_at: r.created_at, payload: { source: "tracker-import", kind: r.kind, total: r.total, due_date: r.due } })));
}

export function feesFor(
  row: { kind: "matter" | "lead"; id: string },
  leadIdOfMatter: string | null,
  proposals: readonly AcceptedFeeRow[],
  tracker: readonly TrackerFeeRow[],
): ReviewFees {
  const mine = proposalsOfRecord(row, leadIdOfMatter, proposals);
  const families = new Set(mine.map((p) => p.family_id)).size;
  let winner: AcceptedFeeRow | null = null;
  for (const p of mine) if (!winner || newer(p, winner)) winner = p;
  const ledger = row.kind === "matter" ? ledgerOf(tracker.filter((t) => t.matter_id === row.id)) : ledgerOf([]);
  const spreadsheet = (total: string | null): FeeCell => (total ? { text: total, from: "spreadsheet" } : null);
  return {
    legal: proposalCell(winner, "legal", families) ?? spreadsheet(ledger.legal_fee?.total ?? null),
    legalDue: ledger.legal_fee?.dueDate ?? null,
    gov: proposalCell(winner, "gov", families) ?? spreadsheet(ledger.filing_fee?.total ?? null),
    govDue: ledger.filing_fee?.dueDate ?? null,
  };
}
