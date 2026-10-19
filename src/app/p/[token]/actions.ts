"use server";

import { acceptPublicProposal } from "@/lib/proposals/public";
import type { ProposalAcceptResult } from "@/components/client-proposal/ProposalDocument";
import { safeHttpsUrl } from "@/components/client-proposal/format";

/**
 * The one server action an ANONYMOUS visitor may invoke on a proposal.
 *
 * ── A SERVER ACTION IS ITS OWN ENTRY POINT ──────────────────────────────────
 * `"use server"` compiles to a POST endpoint that renders neither this route's
 * page nor its layout and inherits nothing from them. The page having resolved
 * the token and checked expiry buys this function nothing: a caller can POST
 * here directly with any arguments. Every argument is hostile. The proposal,
 * its firm, its status, its expiry and every price are re-resolved inside
 * `acceptPublicProposal` from the TOKEN alone, and the price is recomputed from
 * the stored content and the ticked boxes: nothing the browser says about money
 * is read. There is no proposal-id or org-id parameter, so a caller who could
 * name one could not name someone else's.
 *
 * The result is discriminated, never thrown (an uncaught throw reaches the
 * browser as a digest), and carries ONLY `{ ok, payUrl }` or `{ ok, message }`:
 * no proposal id, no org id, no snapshot, no refusal code. The token is never
 * echoed, logged or put in a redirect.
 *
 * `payUrl` is "" when the firm has no usable https payment link on the row; the
 * acceptance is still recorded and the page says the firm will send the link.
 */
export async function acceptProposalAction(token: string, selection: unknown): Promise<ProposalAcceptResult> {
  try {
    const result = await acceptPublicProposal(String(token ?? ""), selection, new Date());
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, payUrl: safeHttpsUrl(result.payUrl) ?? "" };
  } catch {
    return { ok: false, message: "We couldn’t record your acceptance. Please try again." };
  }
}
