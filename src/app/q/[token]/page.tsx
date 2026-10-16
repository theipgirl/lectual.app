import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readPublicQuote, recordQuoteViewed } from "@/lib/quotes/public";
import { firmTakesCardPayments, readPublicPaymentState } from "@/lib/quotes/public-payment";
import { QuoteDocument } from "@/components/proposal/QuoteDocument";
import { Receipt } from "@/components/proposal/Receipt";
import { StatusNotice } from "@/components/proposal/StatusNotice";
import { Unavailable } from "@/components/proposal/Unavailable";

/**
 * `/q/<token>` — the client's proposal. No login; the token is the credential.
 *
 * Every other page is safe because RLS keys on `current_org_id()` from the
 * caller's JWT. There is no JWT here, so RLS is not the boundary on this route
 * — the token is. Everything that makes that safe lives in
 * `src/lib/quotes/public.ts`: the explicit column allowlists, the single exact
 * `.eq("public_token", …)` with no joins, the writes fenced on the id and org
 * read from that row, and the conditional update that makes a second
 * acceptance impossible. Read that file's header before changing anything here.
 *
 * Outcomes, each its own component:
 *  - `not_found`, and an EXPIRED or WITHDRAWN quote → `notFound()`: the locked
 *    page, identical for an unknown token, another firm's, a malformed one, a
 *    DRAFT, and a link that has closed (the design asks for them to look the
 *    same, and a page that told them apart would say which tokens are real).
 *  - `unconfigured` / `unavailable` → `<Unavailable />`, never a 404: telling
 *    a client their proposal does not exist because we could not reach the
 *    database is the worst answer available.
 *  - accepted → `<Receipt />`, from `accepted_snapshot` only, with the Pay
 *    section (spec §7.4) whose state is read server-side here: received /
 *    confirming / payable / manual / unavailable. Only `payable` has a form.
 *  - declined (or a status this build does not know) → `<StatusNotice />`: the
 *    state, no quote body, no controls.
 *  - sent and live → `<QuoteDocument />`, the only branch with accept/decline.
 *
 * The status branched on is `effectiveQuoteStatus` — expiry evaluated on READ,
 * so a client is never shown a live accept button because a job did not run.
 *
 * `force-dynamic` explicitly: the page is keyed on a secret and writes an audit
 * event, so a cached render would serve one client's proposal to another.
 */
export const dynamic = "force-dynamic";

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // One instant for the whole render: expiry and the `viewed` window agree.
  const now = new Date();

  const read = await readPublicQuote(token, now);
  if (read.status === "not_found") notFound();
  if (read.status !== "ok") return <Unavailable />;

  const { view } = read;
  // Locked: resolves to nothing, exactly like a draft — no view is recorded.
  if (view.status === "expired" || view.status === "withdrawn") notFound();

  // Awaited (a dangling promise in a serverless function may be killed with
  // the response) and fully swallowed inside, so a broken audit table cannot
  // take down the page a client came to read.
  await recordQuoteViewed(read.handle, (await headers()).get("user-agent"), now);

  if (view.status === "accepted") {
    const payment = await readPublicPaymentState({ handle: read.handle, snapshot: view.acceptedSnapshot });
    return <Receipt token={token} view={view} payment={payment} />;
  }
  // Fail closed: the accept control is reachable from exactly one branch.
  if (view.status !== "sent") return <StatusNotice view={view} />;
  // Whether a card form follows the signature — from the firm's setup only,
  // never from the package the client hasn't picked yet (runbook defect 4).
  const cardAfterSigning = await firmTakesCardPayments(read.handle);
  return <QuoteDocument token={token} view={view} ready={read.handle.offerIntact} cardAfterSigning={cardAfterSigning} />;
}
