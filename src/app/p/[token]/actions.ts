"use server";

import { headers } from "next/headers";
import { acceptPublicProposal, savePublicDetailsAddress } from "@/lib/proposals/public";
import { reviewLetterPdf, signedLetterPdf, type LetterPdfResult } from "@/lib/proposals/public-letter";
import type { ProposalAcceptResult } from "@/components/client-proposal/ProposalDocument";
import { safeHttpsUrl } from "@/components/client-proposal/format";
import { PDF_MESSAGES, SEND_MESSAGES, SIGN_LINK_MESSAGES } from "@/lib/loe/client-words";
import type { ConsentResult } from "@/lib/loe/email-signing/link-actions";
import {
  entryCloseLink,
  entryRecordConsent,
  entryRecordOpened,
  entrySendLink,
  entrySign,
  type RawAudit,
} from "@/lib/loe/email-signing/public-entry";
import type { SendResult } from "@/lib/loe/email-signing/link-send";
import type { SignResult } from "@/lib/loe/email-signing/sign";

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

/* ── The emailed signing link (lectual 0117, Sprint A) ─────────────────────────────────────────────────────────────────
 * Five more anonymous entry points. The same rules as above: every argument is hostile, the proposal is re-resolved from the
 * TOKEN alone, there is no id parameter, results are fixed sentences, and nothing is logged. The address an email goes to is the
 * proposal row's own client email, never one from the browser. The work is in src/lib/loe/email-signing/public-entry.ts. */

async function audit(): Promise<RawAudit> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

/** Step 3's "Email me a link to sign": ticks, class words and details only. */
export async function sendSigningLinkAction(token: string, selection: unknown, clientClasses: unknown, details: unknown): Promise<SendResult> {
  try {
    return await entrySendLink(String(token ?? ""), selection, clientClasses, details, await audit());
  } catch {
    return { ok: false, message: SEND_MESSAGES.send_failed };
  }
}

/** New choices or details: close the link that was emailed (answers only whether one was closed). */
export async function closeSigningLinkAction(token: string): Promise<{ closed: boolean }> {
  try {
    return await entryCloseLink(String(token ?? ""));
  } catch {
    return { closed: false };
  }
}

/** The `?sign=` page posts this once after mount; nothing the page shows depends on it. */
export async function recordOpenedAction(token: string, signToken: string): Promise<void> {
  try {
    await entryRecordOpened(String(token ?? ""), String(signToken ?? ""), await audit());
  } catch {
    // Silent by design.
  }
}

/** The first click: consent. `consentSha256` is the sha256 of the consent text the page drew. */
export async function recordConsentAction(token: string, signToken: string, consentSha256: unknown): Promise<ConsentResult> {
  try {
    return await entryRecordConsent(String(token ?? ""), String(signToken ?? ""), consentSha256, await audit());
  } catch {
    return { ok: false, message: SIGN_LINK_MESSAGES.try_again };
  }
}

/** Sign: the typed full legal name and the drawn or typed signature. Signs and accepts in one database transaction. */
export async function signByLinkAction(token: string, signToken: string, typedName: unknown, signature: unknown): Promise<SignResult> {
  try {
    return await entrySign(String(token ?? ""), String(signToken ?? ""), typedName, signature, await audit());
  } catch {
    return { ok: false, message: SIGN_LINK_MESSAGES.retry };
  }
}
