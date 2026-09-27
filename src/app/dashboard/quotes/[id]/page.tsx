import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { loadQuote } from "@/lib/quotes/load";
import { listQuoteEvents } from "@/lib/quotes/store";
import { listServiceItems } from "@/lib/quotes/service-library";
import { quoteClientLabels, quoteMatterRef } from "@/lib/quotes/clients";
import { daysUntilQuoteExpiry, effectiveQuoteStatus, isQuoteEditable, quoteStatusLabel } from "@/lib/quotes/status";
import {
  daysLeftLabel,
  describeQuoteEvent,
  expiryInputValue,
  formatFirmStamp,
  formatShortFirmDate,
  quoteReference,
} from "@/lib/quotes/labels";
import { describeLineDrift, toAmount, toCount } from "@/lib/quotes/drift";
import { describeSignedChoice } from "@/lib/quotes/packages";
// The pure snapshot reader from the accept path that WRITES the record, not a
// second parser: the firm's page and the client's receipt must never hold two
// opinions about what a signed agreement is. Nothing else from that module is
// used here — this page reads through the caller's own scoped client.
import { parseAcceptedSnapshot } from "@/lib/quotes/public";
import type { QuoteEventRow, QuoteLineRow } from "@/lib/quotes/types";
import { QuoteBuilder, type BuilderEvent, type BuilderLine } from "@/components/quotes/QuoteBuilder";
import { TermsPanel, type TermsReadOnlyView } from "@/components/quotes/QuoteParts";
import { QuotesRestricted } from "@/components/quotes/QuotesRestricted";
import "../quotes.css";

export const dynamic = "force-dynamic";

/**
 * The quote builder (design/Quote_Builder_Prototype.dc.html): packages with
 * their offer switches, the lines of the one being edited, add-ons, the
 * service library, the two totals, send and the client link, and the activity
 * log — then the engagement terms. `QuoteBuilder` renders it; every write is in
 * `./actions.ts`.
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
 * The builder is handed the SNAPSHOT's lines (what was offered, and what the
 * client took), read-only, and the live rows are used only to show that they
 * have DRIFTED. With no readable snapshot it falls back to the live rows and
 * says so — never presenting current figures as signed.
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
  const mode = effective !== "accepted" ? "live" : snapshot ? "signed" : "signed-missing";
  const termsReadOnly: TermsReadOnlyView | null = editable
    ? null
    : effective !== "accepted"
      ? { kind: "closed", status: quoteStatusLabel(effective).toLowerCase() }
      : snapshot
        ? { kind: "signed", signedTermsBody: snapshot.quote?.terms_body ?? null }
        : { kind: "signed-missing" };

  // Secondary reads, each best-effort: none is why this page exists, so a
  // failure degrades its own part. The events read says so out loud — "no
  // activity" and "couldn't read activity" differ.
  const [eventsRead, serviceItems, clients, origin, matter] = await Promise.all([
    listQuoteEvents(quote.id).then(
      (events): { events: QuoteEventRow[]; error: boolean } => ({ events, error: false }),
      () => ({ events: [], error: true }),
    ),
    listServiceItems().catch(() => []),
    quoteClientLabels([quote]),
    getSiteOrigin(),
    quoteMatterRef(quote.matter_id),
  ]);
  const client = clients.get(quote.id) ?? null;

  // THE client link. `/q/<token>/` only — this app has no per-firm proposal
  // slug (lectual 0070 is not in its databases). trailingSlash is on.
  const publicUrl = `${origin}/q/${quote.public_token}/`;
  const daysLeft = daysUntilQuoteExpiry(quote.expires_at, now);

  const builderLines: BuilderLine[] =
    mode === "signed" && snapshot
      ? snapshot.lines.map((line) => ({
          id: line.id,
          kind: line.kind,
          charge_at: line.charge_at,
          selection: line.selection,
          tier_group: line.tier_group,
          selected: line.selected,
          label: line.label,
          quantity: toCount(line.quantity),
          unit_amount_cents: toAmount(line.unit_amount_cents),
        }))
      : lines.map(toBuilderLine);

  const signedChoice = snapshot ? describeSignedChoice(snapshot.lines) : null;
  const events: BuilderEvent[] = eventsRead.events.map((event) => ({
    id: event.id,
    time: formatFirmStamp(event.created_at),
    text: describeQuoteEvent(event),
    actor: event.actor,
  }));

  return (
    <>
      <QuoteBuilder
        quoteId={quote.id}
        reference={quoteReference(quote.id)}
        title={quote.title}
        status={effective}
        statusLabel={quoteStatusLabel(effective)}
        editable={editable}
        mode={mode}
        client={client ? { label: client.label, href: client.href } : null}
        expiry={quote.expires_at ? { short: formatShortFirmDate(quote.expires_at), days: effective === "sent" || effective === "draft" ? daysLeftLabel(daysLeft) : "" } : null}
        details={{ introBody: quote.intro_body, expiresInput: expiryInputValue(quote.expires_at) }}
        publicUrl={publicUrl}
        currency={quote.currency}
        lines={builderLines}
        drift={snapshot ? describeLineDrift(snapshot.lines, lines) : []}
        signed={
          snapshot
            ? {
                name: quote.accepted_by_name ?? snapshot.signature?.name ?? null,
                acceptedOn: formatShortFirmDate(snapshot.accepted_at ?? quote.accepted_at),
                packageName: signedChoice?.packageName ?? null,
                dueAtSigning: toAmount(snapshot.totals?.due_at_signing),
                dueAtFiling: toAmount(snapshot.totals?.due_at_filing),
                fullProjectCost: toAmount(snapshot.totals?.full_project_cost),
              }
            : null
        }
        library={serviceItems.map((item) => ({ id: item.id, label: item.label, unitAmountCents: item.unit_amount_cents, kind: item.kind }))}
        canManageLibrary={hasRole(session.role, "senior_admin")}
        events={events}
        eventsError={eventsRead.error}
        termsAttached={Boolean((snapshot ? snapshot.quote?.terms_body : quote.terms_body)?.trim())}
        matter={matter}
      />

      <TermsPanel
        quoteId={quote.id}
        termsBody={quote.terms_body}
        readOnly={termsReadOnly}
        isLive={effective === "sent"}
        defaultClientName={client && client.kind !== "matter" ? client.label : ""}
      />
    </>
  );
}

function toBuilderLine(line: QuoteLineRow): BuilderLine {
  return {
    id: line.id,
    kind: line.kind,
    charge_at: line.charge_at,
    selection: line.selection,
    tier_group: line.tier_group,
    selected: line.selected,
    label: line.label,
    quantity: toCount(line.quantity),
    unit_amount_cents: toAmount(line.unit_amount_cents),
  };
}
