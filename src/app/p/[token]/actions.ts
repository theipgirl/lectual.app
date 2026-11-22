"use server";

import { headers } from "next/headers";
import { acceptPublicProposal, savePublicDetailsAddress } from "@/lib/proposals/public";
import { reviewLetterPdf, signedLetterPdf, type LetterPdfResult } from "@/lib/proposals/public-letter";
import type { ProposalAcceptResult } from "@/components/client-proposal/ProposalDocument";
import { safeHttpsUrl } from "@/components/client-proposal/format";
import { ESIGN_LIMIT_SENTENCE, PDF_MESSAGES, SIGN_MESSAGES } from "@/lib/loe/client-words";
import { createHash } from "node:crypto";
import { adobeStartTokenLimiter } from "@/lib/esign/start-limit";
import { startAdobeSigning } from "@/lib/esign/start";
import { inAppBlockedByOpenRequest } from "@/lib/esign/path";
import { readPublicProposal } from "@/lib/proposals/public";
import type { AdobeStartResult } from "@/components/client-proposal/adobe-flow";

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
    // Sprint 5a: while a signing request for this version is open in Adobe Acrobat Sign, the in-app signature is refused here as
    // well as by lectual 0113's amended `client_proposal_sign_and_accept`. Only a read that worked and found one refuses.
    if (signing !== undefined && signing !== null && (await inAppRefused(String(token ?? "")))) return { ok: false, message: SIGN_MESSAGES.esign_open };
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
      // The stored text's sha256: the page shows its own copy of the letter as "signed" only if it hashes to this.
      ...(result.agreementSha256 ? { textSha256: result.agreementSha256 } : {}),
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
    const h = await headers();
    return await signedLetterPdf(String(token ?? ""), new Date(), { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") });
  } catch {
    return { ok: false, message: PDF_MESSAGES.unavailable };
  }
}


/**
 * Continue on "Your details": the typed mailing address goes to the firm's Lawmatics after the response (token and details only).
 * Answers nothing either way: the page neither waits on it nor shows whether it worked.
 */
export async function saveDetailsAction(token: string, details: unknown): Promise<void> {
  try {
    const h = await headers();
    await savePublicDetailsAddress(String(token ?? ""), details, new Date(), undefined, { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") });
  } catch {
    // Silent by design.
  }
}

/** Is an Adobe signing request open for this token's live letter proposal? Token only; false on any doubt (the database decides). */
async function inAppRefused(token: string): Promise<boolean> {
  try {
    const read = await readPublicProposal(token, new Date());
    if (read.status !== "ok" || read.handle.storedStatus !== "sent" || !read.view.content.loe) return false;
    return await inAppBlockedByOpenRequest({ proposalId: read.handle.proposalId, orgId: read.handle.orgId });
  } catch {
    return false;
  }
}

/**
 * Sprint 5a: "Continue to Adobe to sign". Token-only, like Accept: the proposal, its firm and every price are re-resolved from the
 * token inside `startAdobeSigning`; the browser sends only the ticks, its class words, the typed name, the details and the
 * fingerprint of the letter it showed. Answers the Adobe signing URL for a TOP-LEVEL navigation (never stored, never logged),
 * or `fallback: "in_app"` with a fixed sentence, or a fixed refusal.
 */
export async function startAdobeSigningAction(
  token: string,
  selection: unknown,
  clientClasses: unknown,
  details: unknown,
  typedName: unknown,
  fingerprint: unknown,
): Promise<AdobeStartResult> {
  try {
    // A courtesy limit per token, before anything is read.
    const key = `t:${createHash("sha256").update(String(token ?? "")).digest("hex")}`;
    if (!adobeStartTokenLimiter.allowed(key)) return { ok: false, message: ESIGN_LIMIT_SENTENCE };
    adobeStartTokenLimiter.record(key);
    const r = await startAdobeSigning({ token: String(token ?? ""), selection, clientClasses, details, typedName, fingerprint });
    if (r.ok) return { ok: true, url: r.url };
    return "fallback" in r ? { ok: false, fallback: "in_app", message: r.message } : { ok: false, message: r.message };
  } catch {
    return { ok: false, fallback: "in_app", message: SIGN_MESSAGES.generic };
  }
}
