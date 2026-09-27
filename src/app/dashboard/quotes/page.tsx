import Link from "next/link";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { loadLinesForQuotes, loadQuotes } from "@/lib/quotes/load";
import { quoteClientLabels, quoteClientOptions } from "@/lib/quotes/clients";
import { daysUntilQuoteExpiry, effectiveQuoteStatus, formatQuoteExpiry, QUOTE_STATUSES, quoteStatusLabel } from "@/lib/quotes/status";
import { offerHeadline } from "@/lib/quotes/packages";
import { parseAcceptedSnapshot } from "@/lib/quotes/public";
import { toAmount } from "@/lib/quotes/drift";
import { formatCents } from "@/lib/quotes/money";
import { quoteReference, quoteStatusTone } from "@/lib/quotes/labels";
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
 * quotes (not one per quote) and degrade to "—", never to $0.00. An accepted
 * quote shows its SIGNED figures (the snapshot); an unsigned one with packages
 * has no single price until the client picks, so it shows the range across the
 * packages offered (packages.ts's `offerHeadline`, add-ons excluded).
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
                const figures = listFigures(quote, lines);
                const expiry = formatQuoteExpiry(quote.expires_at);
                const daysLeft = daysUntilQuoteExpiry(quote.expires_at, now);
                return (
                  <tr key={quote.id}>
                    <td className="pri wrap">
                      <Link href={`/dashboard/quotes/${quote.id}/`} className="lx-rowlink">
                        {quote.title}
                      </Link>
                      <span className="lx-note lx-num" style={{ marginLeft: 8, fontSize: 12 }}>
                        {quoteReference(quote.id)}
                      </span>
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
                      {figures ? figures.signing : "—"}
                    </td>
                    <td className="lx-num" style={{ textAlign: "right" }}>
                      {figures ? figures.project : "—"}
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

/** "$4,550.00", or "$2,750.00 – $3,650.00" across the packages offered. */
function range(low: number, high: number, currency: string): string {
  return low === high ? formatCents(low, currency) : `${formatCents(low, currency)} – ${formatCents(high, currency)}`;
}

/**
 * The two list figures for one quote. Signed figures for an accepted quote
 * (never re-derived from rows that may have moved since); for any other, the
 * offer's range. Null when the lines could not be read — rendered as "—",
 * never as $0.00.
 */
function listFigures(
  quote: { status: string; accepted_snapshot: Record<string, unknown> | null; currency: string },
  lines: Parameters<typeof offerHeadline>[0] | null,
): { signing: string; project: string } | null {
  const snapshot = quote.status === "accepted" ? parseAcceptedSnapshot(quote.accepted_snapshot) : null;
  if (snapshot) {
    return {
      signing: formatCents(toAmount(snapshot.totals.due_at_signing), snapshot.currency),
      project: formatCents(toAmount(snapshot.totals.full_project_cost), snapshot.currency),
    };
  }
  if (!lines) return null;
  const headline = offerHeadline(lines, quote.currency);
  return {
    signing: range(headline.dueAtSigning.low, headline.dueAtSigning.high, headline.currency),
    project: range(headline.fullProjectCost.low, headline.fullProjectCost.high, headline.currency),
  };
}
