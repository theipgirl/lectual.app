import { bag, field, relatedId, type Raw } from "@/lib/lawmatics/jsonapi";

/**
 * Lawmatics invoices for ONE matter, normalized from the raw JSON:API list. Pure: no I/O.
 *
 * Lawmatics ignores query parameters silently, so the request's `prospect_id` filter is never
 * trusted: an invoice is kept only when its own `relationships.prospect.data.id` equals the
 * matter's Lawmatics id. Foreign invoices, and ones with no readable prospect or amounts, are
 * dropped. Money stays in integer cents; nothing here formats or divides it.
 *
 * NOT verified against a live Lawmatics account: attribute names come from the public API reference.
 */

export type InvoiceStatus = "draft" | "sending" | "sent" | "paid" | "partially_paid" | "past_due" | "forwarded" | "processing" | "unknown";

export type InvoiceRow = {
  id: string;
  /** Lawmatics' invoice number, or null when it sent none. */
  number: number | null;
  status: InvoiceStatus;
  voided: boolean;
  /** YYYY-MM-DD (invoiced_at, else created_at), or null. */
  date: string | null;
  amountCents: number;
  paidCents: number;
  outstandingCents: number;
  /** Only an https URL is kept. */
  pdfUrl: string | null;
};

export type InvoiceTotals = { billedCents: number; paidCents: number; outstandingCents: number; counted: number };

export const BILLING_TITLE = "Billing";
export const NOT_LINKED_LINE = "This matter isn't linked to Lawmatics yet, so its invoices can't be shown.";
export const NO_INVOICES_LINE = "No invoices in Lawmatics for this matter.";
export const NOT_CONNECTED_LINE = "Connect Lawmatics in Settings → Integrations to see invoices.";
export const UNAVAILABLE_LINE = "Invoices couldn't be loaded from Lawmatics right now.";
export const USPTO_NOTE = "Amounts include USPTO fees where invoiced.";
export const TOTALS_NOTE = "Totals leave out void and draft invoices.";

export function cutShortLine(shown: number): string {
  if (shown === 0) return "Lawmatics didn't return all of its invoices, so none could be matched to this matter.";
  return `Showing the first ${shown} invoice${shown === 1 ? "" : "s"}; Lawmatics didn't return them all.`;
}

const STATUSES: ReadonlySet<string> = new Set(["draft", "sending", "sent", "paid", "partially_paid", "past_due", "forwarded", "processing"]);

const STATUS_WORD: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
  paid: "Paid",
  partially_paid: "Partially paid",
  past_due: "Past due",
  forwarded: "Forwarded",
  processing: "Processing",
  unknown: "Status unknown",
};

/** The status as words. A void invoice reads "Void" whatever its status says. */
export function statusWord(row: Pick<InvoiceRow, "status" | "voided">): string {
  return row.voided ? "Void" : STATUS_WORD[row.status];
}

export function isPastDue(row: Pick<InvoiceRow, "status" | "voided">): boolean {
  return !row.voided && row.status === "past_due";
}

/** "001271", the way Lawmatics prints it. */
export function formatInvoiceNumber(n: number | null): string {
  if (n === null || !Number.isInteger(n) || n < 0) return "—";
  return String(n).padStart(6, "0");
}

function cents(rec: Raw, key: string): number | null {
  const v = bag(rec)[key];
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
}

function civil(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** One raw record → a row, or null when it isn't this matter's or can't be read. */
export function normalizeInvoice(rec: Raw, lawmaticsId: string): InvoiceRow | null {
  const prospect = relatedId(rec, "prospect");
  if (prospect === null || prospect !== String(lawmaticsId)) return null;

  const id = field(rec, "id");
  if (!id) return null;

  const amount = cents(rec, "amount_cents");
  const paid = cents(rec, "amount_paid_cents");
  if (amount === null || paid === null) return null;
  // Lawmatics sends outstanding; when it doesn't, it is the difference (integer subtraction only).
  const outstanding = cents(rec, "outstanding_amount_cents") ?? Math.max(0, amount - paid);

  const rawNumber = bag(rec).number;
  const number = typeof rawNumber === "number" && Number.isInteger(rawNumber) ? rawNumber : typeof rawNumber === "string" && /^\d+$/.test(rawNumber) ? Number(rawNumber) : null;

  const rawStatus = field(rec, "status")?.toLowerCase() ?? "";
  const status: InvoiceStatus = STATUSES.has(rawStatus) ? (rawStatus as InvoiceStatus) : "unknown";

  return {
    id,
    number,
    status,
    voided: field(rec, "voided_at") !== null,
    date: civil(field(rec, "invoiced_at")) ?? civil(field(rec, "created_at")),
    amountCents: amount,
    paidCents: paid,
    outstandingCents: outstanding,
    pdfUrl: httpsUrl(field(rec, "pdf_url")),
  };
}

/** Newest first (date, then number); an undated invoice sorts last. */
export function sortNewestFirst(rows: readonly InvoiceRow[]): InvoiceRow[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? 1 : -1;
    }
    return (b.number ?? -1) - (a.number ?? -1);
  });
}

/** This matter's invoices out of a raw list: foreign and unreadable ones dropped, newest first. */
export function normalizeInvoices(records: readonly Raw[], lawmaticsId: string): InvoiceRow[] {
  const seen = new Set<string>();
  const rows: InvoiceRow[] = [];
  for (const rec of records) {
    const row = normalizeInvoice(rec, lawmaticsId);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return sortNewestFirst(rows);
}

/** Billed / paid / outstanding over invoices that are neither void nor draft. */
export function invoiceTotals(rows: readonly InvoiceRow[]): InvoiceTotals {
  const t: InvoiceTotals = { billedCents: 0, paidCents: 0, outstandingCents: 0, counted: 0 };
  for (const r of rows) {
    if (r.voided || r.status === "draft") continue;
    t.billedCents += r.amountCents;
    t.paidCents += r.paidCents;
    t.outstandingCents += r.outstandingCents;
    t.counted += 1;
  }
  return t;
}

export type BillingRead =
  | { status: "ok"; invoices: InvoiceRow[]; totals: InvoiceTotals }
  | { status: "cut-short"; invoices: InvoiceRow[]; totals: InvoiceTotals }
  | { status: "not-linked" }
  | { status: "not-connected" }
  | { status: "unavailable" };
