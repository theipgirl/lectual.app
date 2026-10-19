import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { ProposalNotice } from "@/components/client-proposal/ProposalNotice";
import { readPublicProposal, recordProposalViewed } from "@/lib/proposals/public";
import { acceptProposalAction } from "./actions";

/**
 * `/p/<token>` — the client's proposal. No login; the token is the credential.
 *
 * There is no JWT on this route, so RLS is not the boundary: the token is.
 * Everything that makes that safe lives in `src/lib/proposals/public.ts` (the
 * explicit column allowlists, the single exact `.eq("public_token", …)`, the
 * conditional update that makes a second acceptance impossible). Read its header
 * before changing anything here.
 *
 * Outcomes:
 *  - `not_found`, and a closed proposal (expired or withdrawn) → `notFound()`:
 *    the locked page, identical for an unknown token, another firm's, a
 *    malformed one, a draft and a closed link.
 *  - `unconfigured` / `unavailable` → `<ProposalNotice>` (a 200 that says "try
 *    again"), never a 404: telling a client their proposal does not exist
 *    because we could not reach the database is the worst answer available.
 *  - accepted → the receipt (`mode="accepted"`) from the frozen snapshot.
 *  - sent and live → the interactive page; Accept calls `acceptProposalAction`.
 *
 * Only `PublicProposalView` crosses to the browser: no ids, no token (beyond the
 * one the visitor already holds, bound into the action), no client email.
 *
 * `force-dynamic` explicitly: the page is keyed on a secret and writes an audit
 * event, so a cached render would serve one client's proposal to another.
 */
export const dynamic = "force-dynamic";

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // One instant for the whole render: expiry and the `viewed` window agree.
  const now = new Date();

  const read = await readPublicProposal(token, now);
  if (read.status === "not_found" || read.status === "closed") notFound();
  if (read.status !== "ok") {
    return (
      <ProposalNotice heading="We can’t load this proposal right now.">
        Your link is fine — something on our side is not responding. Please try again in a few minutes. Nothing has been
        accepted.
      </ProposalNotice>
    );
  }

  const { view } = read;

  // Awaited (a dangling promise in a serverless function may be killed with the
  // response) and fully swallowed inside, so a broken audit table cannot take
  // down the page a client came to read.
  await recordProposalViewed(read.handle, (await headers()).get("user-agent"), now);

  if (view.status === "accepted") {
    return (
      <ProposalDocument
        mode="accepted"
        content={view.content}
        title={view.title}
        clientName={view.clientName}
        expiresOn={view.expiresOn}
        firm={{ name: view.firm.name, slug: view.firm.slug }}
        initialSelection={view.acceptedSelection ?? undefined}
        acceptedQuote={view.acceptedQuote ?? undefined}
        payUrl={view.payUrl}
      />
    );
  }

  return (
    <ProposalDocument
      mode="live"
      content={view.content}
      title={view.title}
      clientName={view.clientName}
      expiresOn={view.expiresOn}
      firm={{ name: view.firm.name, slug: view.firm.slug }}
      // The token is bound here, server-side, so the browser calls the action
      // with the ticks only.
      onAccept={acceptProposalAction.bind(null, token)}
    />
  );
}
