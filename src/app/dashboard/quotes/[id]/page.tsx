import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { loadQuote } from "@/lib/quotes/load";
import { listQuoteEvents } from "@/lib/quotes/store";
import { listServiceItems } from "@/lib/quotes/service-library";
import { quoteClientLabels } from "@/lib/quotes/clients";
import { daysUntilQuoteExpiry, effectiveQuoteStatus, formatQuoteExpiry, isQuoteEditable, quoteStatusLabel } from "@/lib/quotes/status";
import { expiryInputValue, formatFirmDateTime, quoteStatusTone } from "@/lib/quotes/labels";
// The pure snapshot reader from the accept path that WRITES the record, not a
// second parser: the firm's page and the client's receipt must never hold two
// opinions about what a signed agreement is. Nothing else from that module is
// used here — this page reads through the caller's own scoped client.
import { parseAcceptedSnapshot } from "@/lib/quotes/public";
import type { QuoteEventRow } from "@/lib/quotes/types";
import { QuoteDetailsForm, QuoteLifecycle, type ServiceItemOption } from "@/components/quotes/QuoteForms";
import { EventsPanel, LinesPanel, SignedLinesPanel, TermsPanel, TotalsPanel, type TermsReadOnlyView } from "@/components/quotes/QuoteParts";
import { QuotesRestricted } from "@/components/quotes/QuotesRestricted";

export const dynamic = "force-dynamic";

/**
 * The quote builder: header, fee lines (service library or custom), the
 * signing/filing totals, the engagement terms, send/withdraw and the client
 * link, and the audit trail. Every write is in `./actions.ts`.
 *
 * ── THREE-STATE READ ────────────────────────────────────────────────────────
 * `unconfigured` and `unavailable` are not a 404. Only an `ok` read that found
 * no row — a wrong id, or another firm's (RLS makes those identical) — is
 * `notFound()`.
 *
 * ── WHO MAY QUOTE: attorney+ ────────────────────────────────────────────────
 * Same gate as the list, checked again here because this URL is reachable by
 * typing it. Checked BEFORE the read and not folded into `notFound()`: telling
 * a paralegal a quote does not exist when it does is a worse answer, not a
 * safer one.
 *
 * ── AN ACCEPTED QUOTE RENDERS FROM `accepted_snapshot` ──────────────────────
 * The live row and lines stay mutable after acceptance; the snapshot is the
 * frozen record of what was signed. Once the effective status is `accepted`,
 * the fees and terms panels render the snapshot and use the live values only
 * to show that they have DRIFTED. With no readable snapshot they fall back to
 * the live values and say so — never presenting current wording as signed.
 */
export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !hasRole(session.role, "attorney")) return <QuotesRestricted title="Quote" />;

  const load = await loadQuote(id);
  if (load.status !== "ok") {
    return (
      <>
        <Link href="/dashboard/quotes/" className="lx-back">
          ← Quotes &amp; proposals
        </Link>
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {load.status === "unconfigured" ? "Quotes aren't set up in this environment" : "This quote couldn't be loaded"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {load.status === "unconfigured"
              ? "The quote tables (lectual migration 0068) are not in this database."
              : "This is a problem reaching the database, not a missing quote. Try again shortly."}
          </p>
        </div>
      </>
    );
  }
  if (!load.quote) notFound();

  const { quote, lines } = load;
  const now = new Date();
  const effective = effectiveQuoteStatus(quote, now);
  const editable = isQuoteEditable(effective);

  const snapshot = effective === "accepted" ? parseAcceptedSnapshot(quote.accepted_snapshot) : null;
  const termsReadOnly: TermsReadOnlyView | null = editable
    ? null
    : effective !== "accepted"
      ? { kind: "closed", status: quoteStatusLabel(effective).toLowerCase() }
      : snapshot
        ? { kind: "signed", signedTermsBody: snapshot.quote?.terms_body ?? null }
        : { kind: "signed-missing" };

  // Secondary reads, each best-effort: none is why this page exists, so a
  // failure degrades its own panel. The events read is the exception that
  // says so out loud — "no activity" and "couldn't read activity" differ.
  const [eventsRead, serviceItems, clients, origin] = await Promise.all([
    listQuoteEvents(quote.id).then(
      (events): { events: QuoteEventRow[]; error: boolean } => ({ events, error: false }),
      () => ({ events: [], error: true }),
    ),
    editable ? listServiceItems().catch(() => []) : Promise.resolve([]),
    quoteClientLabels([quote]),
    getSiteOrigin(),
  ]);
  const client = clients.get(quote.id) ?? null;
  const serviceItemOptions: ServiceItemOption[] = serviceItems.map((item) => ({
    id: item.id,
    label: item.label,
    unit_amount_cents: item.unit_amount_cents,
    kind: item.kind,
  }));

  // THE client link. `/q/<token>/` only — this app has no per-firm proposal
  // slug (lectual 0070 is not in its databases). trailingSlash is on.
  const publicUrl = `${origin}/q/${quote.public_token}/`;
  const expiry = formatQuoteExpiry(quote.expires_at);
  const daysLeft = daysUntilQuoteExpiry(quote.expires_at, now);

  return (
    <>
      <Link href="/dashboard/quotes/" className="lx-back">
        ← Quotes &amp; proposals
      </Link>

      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`lx-pill ${quoteStatusTone(effective)}`}>{quoteStatusLabel(effective)}</span>
            {quote.status !== effective && <span title="Recomputed from the expiry on every read.">stored as {quoteStatusLabel(quote.status)}</span>}
          </div>
          <h1 className="lx-h1">{quote.title}</h1>
          <p className="lx-note" style={{ margin: "6px 0 0" }}>
            {client ? (
              client.href ? (
                <>
                  For <Link href={client.href}>{client.label}</Link>
                </>
              ) : (
                <>For {client.label}</>
              )
            ) : (
              "Not linked to a lead, matter or contact"
            )}
            {expiry && (
              <>
                {" · "}Open until {expiry}
                {effective === "sent" && daysLeft !== null && daysLeft >= 0 ? ` (${daysLeft === 0 ? "today" : `${daysLeft}d`})` : ""}
              </>
            )}
            {quote.sent_at && <> · Sent {formatFirmDateTime(quote.sent_at)}</>}
          </p>
        </div>
      </div>

      {effective === "accepted" && (
        <p role="status" className="lx-banner lx-banner-ok" style={{ margin: 0 }}>
          Accepted{quote.accepted_by_name ? ` by ${quote.accepted_by_name}` : ""}
          {quote.accepted_at ? ` on ${formatFirmDateTime(quote.accepted_at)}` : ""}. The signed copy below is frozen.
        </p>
      )}
      {effective === "declined" && (
        <p role="status" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          The client declined this proposal{quote.declined_at ? ` on ${formatFirmDateTime(quote.declined_at)}` : ""}.
        </p>
      )}

      <section className="lx-card" style={{ padding: 18, display: "grid", gap: 14 }}>
        <QuoteLifecycle quoteId={quote.id} status={quote.status} publicUrl={publicUrl} />
        {editable && (
          <details className="lx-disclosure-inline">
            <summary>Edit title, intro and expiry</summary>
            <QuoteDetailsForm
              quoteId={quote.id}
              title={quote.title}
              introBody={quote.intro_body}
              expiresInput={expiryInputValue(quote.expires_at)}
              isLive={effective === "sent"}
            />
          </details>
        )}
      </section>

      {snapshot ? (
        <SignedLinesPanel snapshot={snapshot} liveLines={lines} />
      ) : (
        <>
          {/* Not over a signed quote: this re-derives the figures from the LIVE
              lines, which may no longer be what was signed. */}
          <TotalsPanel lines={lines} currency={quote.currency} />
          <LinesPanel
            quoteId={quote.id}
            lines={lines}
            editable={editable}
            serviceItems={serviceItemOptions}
            currency={quote.currency}
            signedMissing={effective === "accepted"}
          />
        </>
      )}

      <TermsPanel
        quoteId={quote.id}
        termsBody={quote.terms_body}
        readOnly={termsReadOnly}
        isLive={effective === "sent"}
        defaultClientName={client && client.kind !== "matter" ? client.label : ""}
      />

      <EventsPanel events={eventsRead.events} loadError={eventsRead.error} />
    </>
  );
}
