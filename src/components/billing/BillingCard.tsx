import { formatMoney } from "@/lib/ui/format";
import { LOADING } from "@/lib/ui/words";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import "./billing.css";
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
  return <p className="lx-note">{children}</p>;
}

function InvoiceItem({ row, tz }: { row: InvoiceRow; tz: string }) {
  const date = formatCivilDate(row.date, tz);
  const pastDue = isPastDue(row);
  return (
    <li data-past-due={pastDue ? "true" : undefined} className="bl-item">
      <div className="bl-line">
        <strong>#{formatInvoiceNumber(row.number)}</strong>
        <span className="bl-status">{statusWord(row)}</span>
      </div>
      <div className="lx-note">
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
      <div className="bl-line bl-amounts">
        <span>Amount {formatMoney(row.amountCents)}</span>
        <span>Paid {formatMoney(row.paidCents)}</span>
        <span>Outstanding {formatMoney(row.outstandingCents)}</span>
      </div>
    </li>
  );
}

function Totals({ totals }: { totals: InvoiceTotals }) {
  return (
    <div data-billing-totals className="bl-line bl-totals">
      <span>Billed {formatMoney(totals.billedCents)}</span>
      <span>Paid {formatMoney(totals.paidCents)}</span>
      <span>Outstanding {formatMoney(totals.outstandingCents)}</span>
    </div>
  );
}

export function BillingCard({ read, tz = DEFAULT_TIME_ZONE }: { read: BillingRead; /** The firm's time zone, for the dates. */ tz?: string }) {
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
              <ul className="bl-list">
                {read.invoices.map((row) => (
                  <InvoiceItem key={row.id} row={row} tz={tz} />
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
    <section className="lx-card lx-aside bl-card" aria-label={BILLING_TITLE} data-billing-card>
      <div className="lx-label">{BILLING_TITLE}</div>
      {body}
    </section>
  );
}

export function BillingCardLoading() {
  return (
    <section className="lx-card lx-aside" aria-label={BILLING_TITLE} aria-busy="true">
      <div className="lx-label">{BILLING_TITLE}</div>
      <p className="lx-note">{LOADING}</p>
    </section>
  );
}
