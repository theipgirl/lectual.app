"use server";

import { headers } from "next/headers";
import { acceptPublicProposal } from "@/lib/proposals/public";
import { reviewLetterPdf, signedLetterPdf, type LetterPdfResult } from "@/lib/proposals/public-letter";
import type { ProposalAcceptResult } from "@/components/client-proposal/ProposalDocument";
import { safeHttpsUrl } from "@/components/client-proposal/format";
import { PDF_MESSAGES } from "@/lib/loe/client-words";

/**
 * The server actions an ANONYMOUS visitor may invoke on a proposal: accept (and, when the proposal carries an engagement
 * letter, sign), and the two letter PDFs.
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
 * browser as a digest), and carries ONLY `{ ok, payUrl }` (plus, for a signing, the signed line and
 * the letter's date as text) or `{ ok, message }`:
 * no proposal id, no org id, no snapshot, no refusal code. The token is never
 * echoed, logged or put in a redirect. Nothing the client typed is logged.
 *
 * `clientClasses` is what the client wrote (`{ entries, added }`, see `client-classes.ts`): text only, cleaned
 * and checked against the stored content by `acceptPublicProposal`, never a price.
 *
 * `signing` (engagement letter only) is `{ typedName, agree, details, fingerprint }`: cleaned, checked and compared with the
 * server's own rebuild of the letter. The letter text is never taken from the browser.
 *
 * `payUrl` is "" when the firm has no usable https payment link on the row; the
 * acceptance is still recorded and the page says the firm will send the link.
 */
export async function acceptProposalAction(token: string, selection: unknown, clientClasses?: unknown, signing?: unknown): Promise<ProposalAcceptResult> {
  try {
    const h = await headers();
    // The caller's address and browser, read as the quote engine reads them (`parseInet` and a 400-character cap, applied inside).
    const audit = { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
    const result = await acceptPublicProposal(String(token ?? ""), selection, new Date(), undefined, clientClasses, signing, audit);
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      payUrl: safeHttpsUrl(result.payUrl) ?? "",
      ...(result.signedLine ? { signedLine: result.signedLine } : {}),
      // The letter's date as stamped here at signing: the receipt redraws the letter with it (the page was built with the date at page load).
      ...(result.signedDateText ? { letterDate: result.signedDateText } : {}),
    };
  } catch {
    return { ok: false, message: "We couldn’t record your acceptance. Please try again." };
  }
}

/** The review copy: the letter with the client's details merged in, marked not yet signed. Token and details only. */
export async function downloadReviewLetterAction(token: string, selection: unknown, clientClasses: unknown, details: unknown): Promise<LetterPdfResult> {
  try {
    const h = await headers();
    return await reviewLetterPdf(String(token ?? ""), selection, clientClasses, details, new Date(), { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") });
  } catch {
    return { ok: false, message: PDF_MESSAGES.unavailable };
  }
}

/** The signed copy, rebuilt from what was signed. Token only. */
export async function downloadSignedLetterAction(token: string): Promise<LetterPdfResult> {
  try {
    return await signedLetterPdf(String(token ?? ""), new Date());
  } catch {
    return { ok: false, message: PDF_MESSAGES.unavailable };
  }
}

