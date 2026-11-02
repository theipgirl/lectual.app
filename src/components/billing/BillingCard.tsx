import { formatCents } from "@/lib/quotes/money";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import {
  BILLING_TITLE,
  NOT_CONNECTED_LINE,
  NOT_LINKED_LINE,
  NO_INVOICES_LINE,
  TOTALS_NOTE,
  UNAVAILABLE_LINE,
  USPTO_NOTE,
  cutShortLine,
  formatInvoiceNumber,
  isPastDue,
  statusWord,
  type BillingRead,
  type InvoiceRow,
  type InvoiceTotals,
} from "@/lib/billing/invoices";

/**
 * "Billing": a matter's invoices, read live from the firm's own Lawmatics. Presentational: it takes the
 * result of the read (`src/lib/billing/load.ts`) and the page decides whether to draw it at all (owner only).
 * Every state has its own sentence; a failed read is never an empty list. Nothing here writes or links to a
 * payment: "View PDF" opens Lawmatics' own file when it is an https URL.
 */

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p className="lx-note" style={{ margin: 0 }}>
      {children}
    </p>
  );
}

function InvoiceItem({ row }: { row: InvoiceRow }) {
  const date = formatCivilDate(row.date);
  const pastDue = isPastDue(row);
  return (
    <li
      data-past-due={pastDue ? "true" : undefined}
      style={{
        display: "grid",
        gap: 2,
        padding: "8px 0",
        borderTop: "1px solid var(--line, rgba(0,0,0,0.1))",
        ...(pastDue ? { borderLeft: "3px solid var(--ox)", paddingLeft: 8 } : {}),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong>#{formatInvoiceNumber(row.number)}</strong>
        <span style={pastDue ? { color: "var(--ox)", fontWeight: 600 } : undefined}>{statusWord(row)}</span>
      </div>
      <div className="lx-note" style={{ margin: 0 }}>
        {date ?? "No date"}
        {row.pdfUrl ? (
          <>
            {" · "}
            <a href={row.pdfUrl} target="_blank" rel="noopener noreferrer">
              View PDF
            </a>
          </>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
        <span>Amount {formatCents(row.amountCents)}</span>
        <span>Paid {formatCents(row.paidCents)}</span>
        <span>Outstanding {formatCents(row.outstandingCents)}</span>
      </div>
    </li>
  );
}

function Totals({ totals }: { totals: InvoiceTotals }) {
  return (
    <div
      data-billing-totals
      style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontWeight: 600, borderTop: "2px solid var(--ink)", paddingTop: 8 }}
    >
      <span>Billed {formatCents(totals.billedCents)}</span>
      <span>Paid {formatCents(totals.paidCents)}</span>
      <span>Outstanding {formatCents(totals.outstandingCents)}</span>
    </div>
  );
}

export function BillingCard({ read }: { read: BillingRead }) {
  let body: React.ReactNode;
  switch (read.status) {
    case "not-linked":
      body = <Line>{NOT_LINKED_LINE}</Line>;
      break;
    case "not-connected":
      body = <Line>{NOT_CONNECTED_LINE}</Line>;
      break;
    case "unavailable":
      body = <Line>{UNAVAILABLE_LINE}</Line>;
      break;
    case "ok":
    case "cut-short":
      body = (
        <>
          {read.status === "cut-short" ? <Line>{cutShortLine(read.invoices.length)}</Line> : null}
          {read.invoices.length === 0 ? (
            read.status === "ok" ? (
              <Line>{NO_INVOICES_LINE}</Line>
            ) : null
          ) : (
            <>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {read.invoices.map((row) => (
                  <InvoiceItem key={row.id} row={row} />
                ))}
              </ul>
              <Totals totals={read.totals} />
              <Line>
                {USPTO_NOTE} {TOTALS_NOTE}
              </Line>
            </>
          )}
        </>
      );
      break;
  }
  return (
    <section className="lx-card lx-aside" aria-label={BILLING_TITLE} data-billing-card style={{ display: "grid", gap: 8 }}>
      <div className="lx-label">{BILLING_TITLE}</div>
      {body}
    </section>
  );
}

export function BillingCardLoading() {
  return (
    <section className="lx-card lx-aside" aria-label={BILLING_TITLE} aria-busy="true">
      <div className="lx-label">{BILLING_TITLE}</div>
      <p className="lx-note" style={{ margin: 0 }}>
        Loading invoices from Lawmatics.
      </p>
    </section>
  );
}
