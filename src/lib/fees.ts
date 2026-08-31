import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * The fee ledger the tracker import carries onto a matter.
 *
 * PORTED VERBATIM in behaviour from theipgirl/lectual's
 * `src/lib/matters/fees.ts`. Nothing about the money handling is re-derived
 * here — this file is a mirror, and the two rules below are the whole reason
 * it exists in this form.
 *
 * There is no billing schema yet, and this file is emphatically not one: the
 * firm's spreadsheet recorded a legal-fee and a filing-fee block per matter,
 * the backfill lands each populated block as an ordinary append-only
 * `crm_activity` row, and this module reads the LATEST row per kind back out
 * so the matter page can show what the firm already knows about the money.
 *
 * Payload contract written by the backfill:
 *
 *   { source: 'tracker-import', kind: 'legal_fee' | 'filing_fee',
 *     total, paid, balance, due_date?, source_hash }
 *
 * Two rules that hold everywhere below:
 *
 *  1. **Amounts are strings, and they are rendered verbatim.** The tracker
 *     stored "$4,750" and "$0.00" as the firm typed them. Nothing here parses
 *     an amount into a number to re-render it, nothing recomputes a balance
 *     from total − paid, and nothing sums a column across matters. This is a
 *     law firm's money: the only honest thing to show is exactly what the
 *     record says. The one numeric read is `balanceIsOutstanding`, which
 *     decides *emphasis only* and never changes a displayed figure.
 *  2. **Missing and extra keys are survivable.** A row missing `paid`, or
 *     carrying keys nobody has designed a cell for yet, must degrade to an em
 *     dash rather than throw.
 *
 * Consequence worth stating for whoever builds the money surfaces next: there
 * is deliberately no `totalOutstanding()` in this module and there must not be
 * one. A total over verbatim strings would require parsing them, and a parsed
 * figure shown to an attorney is a figure the record does not contain.
 */

export const FEE_KINDS = ["legal_fee", "filing_fee"] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const FEE_KIND_LABEL: Record<FeeKind, string> = {
  legal_fee: "Legal fee",
  filing_fee: "Filing fee",
};

/** One fee block as the tracker recorded it. Amounts stay verbatim strings. */
export type FeeEntry = {
  kind: FeeKind;
  total: string | null;
  paid: string | null;
  balance: string | null;
  /** Civil date string as recorded, when the block carried one. */
  dueDate: string | null;
  /** When the entry was written to the timeline — how "latest" is decided. */
  recordedAt: string | null;
};

/** Latest entry per kind. A kind the firm never recorded stays null. */
export type FeeLedger = { [K in FeeKind]: FeeEntry | null };

export const EMPTY_FEE_LEDGER: FeeLedger = { legal_fee: null, filing_fee: null };

/** The minimum an activity row must look like to be considered here. */
export type FeeActivityLike = {
  created_at?: string | null;
  payload?: unknown;
};

function isFeeKind(value: unknown): value is FeeKind {
  return typeof value === "string" && (FEE_KINDS as readonly string[]).includes(value);
}

/**
 * A recorded amount, or null. Numbers are accepted (a future writer may store
 * them) and stringified without formatting; anything else — objects, booleans,
 * blank strings — reads as "not recorded" rather than as a fabricated zero.
 */
function readAmount(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Reads one tracker fee entry out of an activity row, or null when the row
 * isn't one. A row is a fee entry only when it carries BOTH
 * `source === 'tracker-import'` and a known fee `kind` — a note that happens
 * to mention money is not a ledger line.
 */
export function parseFeeActivity(row: FeeActivityLike): FeeEntry | null {
  const payload = row?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (p.source !== "tracker-import") return null;
  if (!isFeeKind(p.kind)) return null;

  return {
    kind: p.kind,
    total: readAmount(p.total),
    paid: readAmount(p.paid),
    balance: readAmount(p.balance),
    dueDate: readAmount(p.due_date),
    recordedAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

/**
 * The latest entry per fee kind out of a matter's activity rows.
 *
 * Callers pass whatever order the query returned; every candidate is compared
 * on `created_at` rather than trusting that order, so a newest-first feed and
 * an oldest-first one give the same answer. Ties (same timestamp, or rows with
 * no parseable timestamp) resolve to the LAST one seen, matching the
 * append-only table's own insertion order.
 */
export function latestFeeEntries(rows: readonly FeeActivityLike[]): FeeLedger {
  const ledger: FeeLedger = { legal_fee: null, filing_fee: null };
  if (!rows) return ledger;

  for (const row of rows) {
    const entry = parseFeeActivity(row);
    if (!entry) continue;
    const current = ledger[entry.kind];
    if (!current || !isNewer(current, entry)) ledger[entry.kind] = entry;
  }
  return ledger;
}

/** True when `a` is strictly newer than `b` (an unstamped row is oldest). */
function isNewer(a: FeeEntry, b: FeeEntry): boolean {
  const at = a.recordedAt ? Date.parse(a.recordedAt) : NaN;
  const bt = b.recordedAt ? Date.parse(b.recordedAt) : NaN;
  if (Number.isNaN(at)) return false; // unstamped current loses to anything later
  if (Number.isNaN(bt)) return true; // keep the stamped one over an unstamped
  return at > bt;
}

/** Does this matter have any fee record at all? Drives whether the card renders. */
export function hasFeeEntries(ledger: FeeLedger): boolean {
  return FEE_KINDS.some((kind) => ledger[kind] !== null);
}

/**
 * Is there money still owed on this line?
 *
 * Emphasis only — the returned boolean picks a tone, never a figure. Reads the
 * balance leniently (currency symbol, thousands separators, a trailing minus,
 * accounting parentheses) and fails to `false` when it can't tell, so an
 * unfamiliar format renders plainly instead of shouting a debt that may not
 * exist.
 */
export function balanceIsOutstanding(balance: string | null): boolean {
  if (!balance) return false;
  const raw = balance.trim();
  const negated = /^\(.*\)$/.test(raw) || raw.startsWith("-") || raw.endsWith("-");
  const digits = raw.replace(/[^0-9.]/g, "");
  if (digits === "" || digits === ".") return false;
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return false;
  return !negated && value > 0;
}

/**
 * The matter's fee ledger, read through the caller's own scoped client — RLS
 * is what proves the rows belong to the caller's org. Never a service-role
 * client; this app ships no service-role key at all. No `org_id` filter, for
 * the reason stated in every read module here.
 *
 * The payload predicate is applied in `latestFeeEntries` rather than in SQL:
 * matching on `payload->>'source'` server-side would make an unexpected row
 * shape an error on the page, and there are only ever a handful of activity
 * rows per matter.
 */
export async function matterFeeLedger(matterId: string): Promise<FeeLedger> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("created_at, payload")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return latestFeeEntries((data ?? []) as FeeActivityLike[]);
}
