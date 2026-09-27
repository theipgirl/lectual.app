import Link from "next/link";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { loadLinesForQuotes, loadQuotes } from "@/lib/quotes/load";
import { quoteClientLabels, quoteClientOptions } from "@/lib/quotes/clients";
import { daysUntilQuoteExpiry, effectiveQuoteStatus, formatQuoteExpiry, QUOTE_STATUSES, quoteStatusLabel } from "@/lib/quotes/status";
import { fullProjectCost, quoteTotals } from "@/lib/quotes/pricing";
import { formatCents } from "@/lib/quotes/money";
import { quoteStatusTone } from "@/lib/quotes/labels";
import { relativeTime } from "@/lib/relative-time";
import { NewQuoteForm } from "@/components/quotes/QuoteForms";
import { QuotesRestricted } from "@/components/quotes/QuotesRestricted";

export const dynamic = "force-dynamic";

/**
 * Quotes & proposals — the firm's proposals, filtered by status, over a
 * three-state read.
 *
 * ── THE FILTER IS THE EFFECTIVE STATUS, NOT THE STORED ONE ──────────────────
 * `loadQuotes` does not know about expiry, so this page computes each quote's
 * `effectiveQuoteStatus` against ONE shared `now` and filters on that. A `sent`
 * quote past its `expires_at` shows (and filters) as Expired — never as a live
 * quote that happens to be too late to sign.
 *
 * ── THREE STATES, NEVER TWO ─────────────────────────────────────────────────
 * `unavailable` never falls through to "No quotes yet": that would tell a firm
 * it has no proposals out when the truth is this page could not check.
 *
 * ── WHO MAY QUOTE: attorney+ (owner, admin, senior_admin, attorney) ─────────
 * The firm decided quoting is configuration, not casework (lectual's decision,
 * kept). `hasRole(role, "attorney")` admits exactly those four — attorney sits
 * directly under the admin tier in ROLES. RLS on `crm_quote` still admits the
 * wider staff list; the database boundary is tenancy, this is a product
 * decision inside one firm, and the mismatch is the design.
 *
 * The refusal is an explanatory card, not `notFound()`: this gate is entirely
 * inside one firm, so naming the roles that may quote discloses nothing a
 * colleague couldn't ask. (A MODULE refusal must not explain itself — that
 * would tell one firm what another has.)
 *
 * ── NEW IN lectual.app ──────────────────────────────────────────────────────
 * Client and total columns. Totals are one extra `.in()` read over the listed
 * quotes (not one per quote) and degrade to "—", never to $0.00.
 */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusRaw } = await searchParams;
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !hasRole(session.role, "attorney")) return <QuotesRestricted title="Quotes & proposals" />;

  const now = new Date();
  const status = QUOTE_STATUSES.includes(statusRaw as never) ? statusRaw : undefined;
  const canManageLibrary = hasRole(session.role, "senior_admin");

  const [load, options] = await Promise.all([loadQuotes(), quoteClientOptions()]);
  const all = load.status === "ok" ? load.quotes.map((quote) => ({ quote, effective: effectiveQuoteStatus(quote, now) })) : [];
  const rows = status ? all.filter((r) => r.effective === status) : all;
  const [linesByQuote, clients] = await Promise.all([
    loadLinesForQuotes(rows.map((r) => r.quote.id)),
    quoteClientLabels(rows.map((r) => r.quote)),
  ]);

  // Counts from the UNFILTERED set: a chip's count is that status's real size.
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.effective, (counts.get(r.effective) ?? 0) + 1);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Intake</div>
          <h1 className="lx-h1">Quotes &amp; proposals</h1>
          <p className="lx-sub">
            Flat-fee proposals a client reviews and signs online. Legal fees and USPTO filing fees are always quoted and
            charged separately — a quote never bills the government fee at signing.
          </p>
        </div>
        {canManageLibrary && (
          <Link href="/dashboard/settings/services/" className="lx-btn lx-btn-sec">
            Service library
          </Link>
        )}
      </div>

      <details className="lx-card lx-disclosure">
        <summary>New quote</summary>
        <NewQuoteForm options={options} />
      </details>

      {load.status === "ok" && all.length > 0 && (
        <nav aria-label="Filter quotes by status" className="lx-chips">
          <Link href="/dashboard/quotes/" aria-current={!status ? "page" : undefined}>
            All
            <span className="lx-chip-count">{all.length}</span>
          </Link>
          {QUOTE_STATUSES.map((s) => {
            const count = counts.get(s) ?? 0;
            if (count === 0 && status !== s) return null;
            return (
              <Link key={s} href={`/dashboard/quotes/?status=${s}`} aria-current={status === s ? "page" : undefined}>
                {quoteStatusLabel(s)}
                <span className="lx-chip-count">{count}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {load.status === "unconfigured" ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Quotes aren&apos;t set up in this environment
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            The quote tables (lectual migration 0068) are not in this database. Nothing is broken — it needs the migration.
          </p>
        </div>
      ) : load.status === "unavailable" ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Quotes couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            This is a problem reaching the database, not an empty list. Try again shortly.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {all.length === 0 ? "No quotes yet" : "Nothing matches"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {all.length === 0 ? "Start one above. It stays a draft until you send it." : "Every quote is still here — try another filter."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Quote</th>
                <th>Client</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Due at signing</th>
                <th style={{ textAlign: "right" }}>Project cost</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ quote, effective }) => {
                const client = clients.get(quote.id);
                const lines = linesByQuote?.get(quote.id) ?? (linesByQuote ? [] : null);
                const totals = lines ? quoteTotals(lines, quote.currency) : null;
                const expiry = formatQuoteExpiry(quote.expires_at);
                const daysLeft = daysUntilQuoteExpiry(quote.expires_at, now);
                return (
                  <tr key={quote.id}>
                    <td className="pri wrap">
                      <Link href={`/dashboard/quotes/${quote.id}/`} className="lx-rowlink">
                        {quote.title}
                      </Link>
                      {effective === "sent" && expiry && (
                        <div className="lx-note">
                          Open until {expiry}
                          {daysLeft !== null && daysLeft >= 0 ? ` · ${daysLeft === 0 ? "today" : `${daysLeft}d`}` : ""}
                        </div>
                      )}
                    </td>
                    <td>{client ? client.label : <span className="lx-note">—</span>}</td>
                    <td>
                      <span className={`lx-pill ${quoteStatusTone(effective)}`}>{quoteStatusLabel(effective)}</span>
                    </td>
                    <td className="lx-num" style={{ textAlign: "right" }}>
                      {totals ? formatCents(totals.dueAtSigning, totals.currency) : "—"}
                    </td>
                    <td className="lx-num" style={{ textAlign: "right" }}>
                      {totals ? formatCents(fullProjectCost(totals), totals.currency) : "—"}
                    </td>
                    <td className="lx-num">{relativeTime(quote.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {load.status === "ok" && linesByQuote === null && rows.length > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          Totals couldn&apos;t be loaded just now — open a quote to see its figures.
        </p>
      )}
    </>
  );
}
