import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatter, resolveMatterClientName } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import { hasRole } from "@/lib/auth/roles";
import { resolveViewSession } from "@/lib/views/view-as";
import { getFirmTimeZone } from "@/lib/org/profile";
import { orgHasModule } from "@/lib/org/modules";
import {
  LOE_QUOTE_NONE,
  LOE_QUOTE_PICK,
  buildLoePrefill,
  chooseLoeQuote,
  type LoePrefill,
} from "@/lib/documents/loe-prefill";
import { loadSignedQuotesForMatter, type SignedQuoteForLoe } from "@/lib/documents/loe-prefill-load";
import { Notice, PageHeader } from "@/components/ui";
import { NEW_LETTER_NAMES } from "@/lib/ui/words";
import "@/components/documents/documents.css";
import LoeForm from "./_components/LoeForm";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(NEW_LETTER_NAMES.loe) };

export const dynamic = "force-dynamic";

/**
 * The engagement-letter form. When the matter has a SIGNED quote the form opens
 * pre-filled from the quote's frozen snapshot (loe-prefill.ts); with no signed
 * quote it is the blank form it has always been.
 *
 * The Document Center module gate is the segment layout's (../../layout.tsx);
 * the generate action re-checks it. This page checks it too, FIRST: a layout
 * and its page render in parallel, and this page now reads the client's signed
 * amounts, so it does not lean on the layout having thrown before its reads run.
 * Quotes are read only through the caller's scoped client.
 *
 * ── THE READ HAS THREE STATES ───────────────────────────────────────────────
 * `unavailable` is shown as "we couldn't check", never as "no signed quote",
 * and the blank form stays usable underneath it.
 *
 * ── WHICH QUOTE ─────────────────────────────────────────────────────────────
 * One signed quote: used. Several: staff choose (`?quote=<id>`), nothing is
 * guessed. `?quote=none` is "fill it in by hand".
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ quote?: string | string[] }>;
}) {
  const { matterId } = await params;
  const { quote: quoteParamRaw } = await searchParams;
  const quoteParam = Array.isArray(quoteParamRaw) ? quoteParamRaw[0] : quoteParamRaw;

  if (!(await orgHasModule("document-center"))) notFound();

  const matter = await getMatter(matterId);
  if (!matter) notFound();

  const [session, load, timeZone] = await Promise.all([
    resolveViewSession(),
    loadSignedQuotesForMatter(matter.id),
    getFirmTimeZone(),
  ]);
  // The quote page is for the firm's principals; a link to it is for them only.
  const canOpenQuote = session.kind === "ok" && hasRole(session.role, "attorney");

  const quotes = load.status === "ok" ? load.quotes : [];
  const choice = chooseLoeQuote(
    quotes.map((q) => ({ quoteId: q.quoteId, readable: q.snapshot !== null })),
    quoteParam,
  );
  const chosen = quotes.find((q) => q.quoteId === choice.quoteId) ?? null;

  const toPrefill = (q: SignedQuoteForLoe): LoePrefill | null =>
    q.snapshot ? buildLoePrefill({ quoteId: q.quoteId, snapshot: q.snapshot, matter, acceptedAt: q.acceptedAt, timeZone }) : null;
  const prefill = choice.mode === "prefill" && chosen ? toPrefill(chosen) : null;
  // Only a convenience: if the name can't be resolved the field starts empty, as it always has.
  const clientName = prefill ? ((await resolveMatterClientName(matter).catch(() => null))?.name ?? "") : "";

  const base = `/dashboard/documents/new/${matter.id}/loe/`;
  const quoteHref = (id: string) => `${base}?quote=${encodeURIComponent(id)}`;

  return (
    <>
      <PageHeader
        back={{ href: `/dashboard/documents/new/${matter.id}/`, label: matterLabel(matter) }}
        title={NEW_LETTER_NAMES.loe}
        sub={"Trademark matters use the firm's fee chart: pick the current or legacy template explicitly, it's never guessed. Other matters use the general letter: describe the scope and it becomes bullet points; fee and deposit figures are exactly what you enter."}
      />

      {load.status === "unavailable" && (
        <Notice tone="risk" role="alert">
          We couldn&apos;t check whether this matter has a signed quote, so nothing is pre-filled. That does not mean there isn&apos;t one. Reload to try
          again, or fill the letter in by hand below.
        </Notice>
      )}
      {load.status === "unconfigured" && (
        <p className="lx-note">Quotes aren&apos;t switched on for your firm yet, so there is nothing to pre-fill from.</p>
      )}
      {choice.invalidParam && (
        <Notice tone="warn" role="status">
          The link named a quote that isn&apos;t a signed quote on this matter, so it was ignored.
        </Notice>
      )}

      {choice.mode === "pick" && (
        <section className="lx-card lx-pad dl-stack">
          <div>
            <h2 className="lx-h2">This matter has {quotes.length} signed quotes</h2>
            <p className="lx-note">
              Choose the one this letter is for. Nothing is guessed: the letter takes its package, class count and amounts from the quote you pick, exactly as
              the client signed it.
            </p>
          </div>
          <div className="lx-kpis">
            {quotes.map((q) => {
              const preview = toPrefill(q);
              return preview ? (
                <Link key={q.quoteId} href={quoteHref(q.quoteId)} className="lx-card lx-kpi">
                  <span className="dl-ref">
                    {preview.reference}
                  </span>
                  <span className="dl-ink">{preview.packageName || q.title || "Signed quote"}</span>
                  <span className="lx-note">
                    {preview.acceptedOn ? `Signed ${preview.acceptedOn} · ` : ""}
                    {preview.totals.dueAtSigning} due at signing
                  </span>
                </Link>
              ) : (
                <div key={q.quoteId} className="lx-card lx-kpi" aria-disabled="true">
                  <span className="dl-ref">
                    {q.reference}
                  </span>
                  <span className="lx-note">Signed, but no readable signed copy is stored, so it can&apos;t be used to pre-fill.</span>
                </div>
              );
            })}
          </div>
          <Link href={`${base}?quote=${LOE_QUOTE_NONE}`} className="lx-note">
            Fill it in by hand instead
          </Link>
        </section>
      )}

      {choice.mode === "unreadable" && chosen && (
        <Notice tone="warn" role="alert">
          Signed quote <b>{chosen.reference}</b>{" "}has no readable signed copy stored, so nothing can be pre-filled from it. The letter is never built from the
          quote&apos;s current lines. Fill it in by hand below
          {canOpenQuote ? (
            <>
              , or <Link href={`/dashboard/quotes/${chosen.quoteId}/`}>open the quote</Link>
            </>
          ) : null}
          .
          {quotes.length > 1 && (
            <>
              {" "}
              <Link href={`${base}?quote=${LOE_QUOTE_PICK}`}>Choose a different signed quote</Link>.
            </>
          )}
        </Notice>
      )}

      {choice.mode === "manual" && (
        <Notice tone="mute" role="status">
          Filling this in by hand. This matter has {quotes.length === 1 ? "a signed quote" : `${quotes.length} signed quotes`} (
          {quotes.map((q) => q.reference).join(", ")}).{" "}
          <Link href={quotes.length === 1 ? quoteHref(quotes[0].quoteId) : `${base}?quote=${LOE_QUOTE_PICK}`}>
            {quotes.length === 1 ? "Pre-fill from it" : "Choose one to pre-fill from"}
          </Link>
          .
        </Notice>
      )}

      {prefill && (
        <section role="status" className="lx-card lx-pad dl-stack">
          <div className="lx-label">Pre-filled from the signed quote</div>
          <p className="dl-lead">
            From signed quote{" "}
            {canOpenQuote ? (
              <Link href={`/dashboard/quotes/${prefill.quoteId}/`}>
                <b>{prefill.reference}</b>
              </Link>
            ) : (
              <b>{prefill.reference}</b>
            )}
            {prefill.acceptedOn ? ` on ${prefill.acceptedOn}` : ""}
            {prefill.signerName ? `, signed by ${prefill.signerName}` : ""}.
          </p>
          <p className="lx-note">
            {prefill.totals.dueAtSigning} due at signing · {prefill.totals.dueAtFiling} due at filing · full project cost {prefill.totals.fullProjectCost}. These are
            the figures frozen when the client signed, not re-priced from the quote as it stands now. Every field below can be changed, and any change to a
            signed figure is flagged for the approver. The template is yours to choose; nothing here selects it.
          </p>
          {prefill.checks.length > 0 && (
            <Notice tone="warn">
              <b>Check before generating</b>
              <ul className="lx-flags dl-flags">
                {prefill.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="dl-links">
            {quotes.length > 1 && (
              <Link href={`${base}?quote=${LOE_QUOTE_PICK}`} className="lx-note">
                Use a different signed quote
              </Link>
            )}
            <Link href={`${base}?quote=${LOE_QUOTE_NONE}`} className="lx-note">
              Fill it in by hand instead
            </Link>
          </div>
        </section>
      )}

      {choice.mode !== "pick" && (
        <LoeForm
          key={prefill?.quoteId ?? "blank"}
          matterId={matter.id}
          defaultMarkText={matter.mark_text}
          defaultPackage={matter.package_name}
          prefill={prefill}
          defaultClientName={clientName}
          initialKind={prefill ? (matter.type === "TM" ? "trademark" : "general") : undefined}
        />
      )}
    </>
  );
}
