import Link from "next/link";
import { redirect } from "next/navigation";
import { orgHasModule } from "@/lib/org/modules";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { loadLinesForQuotes, loadQuotes } from "@/lib/quotes/load";
import { quoteClientLabels, quoteClientOptions } from "@/lib/quotes/clients";
import { daysUntilQuoteExpiry, effectiveQuoteStatus, QUOTE_STATUSES, quoteStatusLabel } from "@/lib/quotes/status";
import { offerHeadline } from "@/lib/quotes/packages";
import { parseAcceptedSnapshot } from "@/lib/quotes/public";
import { toAmount } from "@/lib/quotes/drift";
import { moneyFor } from "@/lib/quotes/staff-money";
import { quotePillTone, quoteReference } from "@/lib/quotes/labels";
import { getFirmTimeZone } from "@/lib/org/profile";
import { relativeTime } from "@/lib/relative-time";
import { NewQuoteButton, NewQuotePanel } from "@/components/quotes/NewQuote";
import { Chip, FilterChips } from "@/components/list-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailedCard, LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { formatDay } from "@/lib/ui/dates";
import { QuotesRestricted } from "@/components/quotes/QuotesRestricted";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { BLANK, PROPOSALS_NAME, notReadyPlural } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(PROPOSALS_NAME) };

export const dynamic = "force-dynamic";

/**
 * Proposals (the older quote surface) — the firm's proposals, filtered by status, over a
 * three-state read. For a firm holding the `proposals` module this list
 * redirects to /dashboard/proposals/; `/dashboard/quotes/[id]` and the public
 * quote and signing routes are untouched.
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
  // One proposals surface: a firm with Client proposals lands there. A firm without
  // the module keeps this page (modules fail closed, and it may still need it).
  // Runs before the role gate: the proposals page is readable by the whole firm.
  if (await orgHasModule("proposals")) redirect("/dashboard/proposals/");
  const { status: statusRaw } = await searchParams;
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !hasRole(session.role, "attorney")) return <QuotesRestricted title={PROPOSALS_NAME} />;

  const now = new Date();
  const status = QUOTE_STATUSES.includes(statusRaw as never) ? statusRaw : undefined;
  const canManageLibrary = hasRole(session.role, "senior_admin");

  const [load, options, tz] = await Promise.all([loadQuotes(), quoteClientOptions(), getFirmTimeZone()]);
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
      <PageHeader
        title={PROPOSALS_NAME}
        sub="Flat-fee proposals a client reviews and signs online. Legal fees and USPTO filing fees are always quoted and charged separately — a quote never bills the government fee at signing."
        actions={
          <>
            {canManageLibrary && (
              <Link href="/dashboard/settings/services/" className="lx-btn lx-btn-sec">
                Service library
              </Link>
            )}
            <NewQuoteButton />
          </>
        }
      />

      <NewQuotePanel options={options} />

      {load.status === "ok" && all.length > 0 && (
        <FilterChips as="nav" label="Filter quotes by status">
          <Chip href="/dashboard/quotes/" active={!status} count={all.length}>
            All
          </Chip>
          {QUOTE_STATUSES.map((s) => {
            const count = counts.get(s) ?? 0;
            if (count === 0 && status !== s) return null;
            return (
              <Chip key={s} href={`/dashboard/quotes/?status=${s}`} active={status === s} count={count}>
                {quoteStatusLabel(s)}
              </Chip>
            );
          })}
        </FilterChips>
      )}

      {load.status === "unconfigured" ? (
        <EmptyState>{notReadyPlural("Quotes")}</EmptyState>
      ) : load.status === "unavailable" ? (
        <LoadFailedCard what="quotes" />
      ) : rows.length === 0 ? (
        <EmptyState title={all.length === 0 ? "No quotes yet" : "No quote matches this filter"}>
          {all.length === 0 ? "Start one with New quote. It stays a draft until you send it." : "Every quote is still here — try another filter."}
        </EmptyState>
      ) : (
        <SheetCard>
          <SheetScroll>
            <SheetTable minWidth={820}>
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th className="num">Due at signing</th>
                  <th className="num">Project cost</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ quote, effective }) => {
                  const client = clients.get(quote.id);
                  const lines = linesByQuote?.get(quote.id) ?? (linesByQuote ? [] : null);
                  const figures = listFigures(quote, lines);
                  const expiry = quote.expires_at ? formatDay(quote.expires_at, { tz }) : null;
                  const daysLeft = daysUntilQuoteExpiry(quote.expires_at, now, tz);
                  return (
                    <tr key={quote.id}>
                      <td className="pri wrap">
                        <Link href={`/dashboard/quotes/${quote.id}/`} className="lx-rowlink">
                          {quote.title}
                        </Link>
                        <div className="lx-note">
                          {quoteReference(quote.id)}
                          {effective === "sent" && expiry
                            ? ` · Open until ${expiry}${daysLeft !== null && daysLeft >= 0 ? ` · ${daysLeft === 0 ? "today" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}` : ""}`
                            : ""}
                        </div>
                      </td>
                      <td data-label="Client">{client ? client.label : <span className="lx-note">{BLANK}</span>}</td>
                      <td data-label="Status">
                        <Pill tone={quotePillTone(effective)}>{quoteStatusLabel(effective)}</Pill>
                      </td>
                      <td className="num" data-label="Due at signing">
                        {figures ? figures.signing : BLANK}
                      </td>
                      <td className="num" data-label="Project cost">
                        {figures ? figures.project : BLANK}
                      </td>
                      <td data-label="Updated">{relativeTime(quote.updated_at, now.getTime(), tz)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
      {load.status === "ok" && linesByQuote === null && rows.length > 0 && (
        <LoadFailedLine>Totals couldn&apos;t be loaded just now — open a quote to see its figures.</LoadFailedLine>
      )}
    </>
  );
}

/** "$4,550", or "$2,750 – $3,650" across the packages offered. */
function range(low: number, high: number, currency: string): string {
  return low === high ? moneyFor(low, currency) : `${moneyFor(low, currency)} – ${moneyFor(high, currency)}`;
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
      signing: moneyFor(toAmount(snapshot.totals.due_at_signing), snapshot.currency),
      project: moneyFor(toAmount(snapshot.totals.full_project_cost), snapshot.currency),
    };
  }
  if (!lines) return null;
  const headline = offerHeadline(lines, quote.currency);
  return {
    signing: range(headline.dueAtSigning.low, headline.dueAtSigning.high, headline.currency),
    project: range(headline.fullProjectCost.low, headline.fullProjectCost.high, headline.currency),
  };
}
