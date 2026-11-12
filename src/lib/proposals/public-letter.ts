import "server-only";

import { createHash } from "node:crypto";
import { money } from "@/components/client-proposal/format";
import { PDF_MESSAGES } from "@/lib/loe/client-words";
import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { buildExhibit } from "@/lib/loe/exhibit";
import { buildLetterPdf } from "@/lib/loe/pdf";
import { reviewAddressLimiter, reviewTokenLimiter } from "@/lib/loe/review-limit";
import { assembleAgreement, checkSigning, cleanSigningDetails, letterDateText } from "@/lib/loe/signing";
import { parseInet } from "@/lib/quotes/public";
import { parseClientClassInput, quoteWithClientClasses } from "./client-classes";
import { normalizeSelection } from "./pricing";
import { readPublicProposal, type PublicProposalsDb } from "./public";
import { isWellFormedProposalToken } from "./types";

/**
 * The engagement letter as a PDF for the client, on the anonymous `/p/[token]` page. Two functions, both token-only:
 *
 *  - `reviewLetterPdf`: the letter with the client's details and today's date merged in, marked "Review copy - not yet
 *    signed". Built from the STORED letter, the recomputed quote and the CLEANED details: the browser sends details and
 *    ticks only, never letter text or money. Refuses a proposal that is not live (withdrawn, expired, replaced, or already
 *    signed), is rate limited, and logs nothing.
 *  - `signedLetterPdf`: the letter as signed, rebuilt from the accepted snapshot alone, with the signature record.
 *
 * There is no proposal-id or org-id parameter: a caller who could name one could not name someone else's. The result carries
 * base64 bytes or a fixed sentence, never raw error text.
 */

export type { LetterPdfResult };

const fail = (message: string): LetterPdfResult => ({ ok: false, message });

function filenameFor(clientName: string, signed: boolean): string {
  const slug = clientName
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug ? `${slug}-` : ""}engagement-letter${signed ? "-signed" : "-review-copy"}.pdf`;
}

export async function reviewLetterPdf(
  token: string,
  selection: unknown,
  clientClasses: unknown,
  rawDetails: unknown,
  now: Date,
  opts: { db?: PublicProposalsDb; ip?: string | null } = {},
): Promise<LetterPdfResult> {
  // A malformed token is refused before anything is counted or read (it cannot belong to any proposal).
  if (!isWellFormedProposalToken(String(token ?? ""))) return fail(PDF_MESSAGES.not_open);
  const tokenKey = `t:${createHash("sha256").update(String(token ?? "")).digest("hex")}`;
  const ipKey = `ip:${parseInet(opts.ip) ?? "unknown"}`;
  if (!reviewTokenLimiter.allowed(tokenKey) || !reviewAddressLimiter.allowed(ipKey)) return fail(PDF_MESSAGES.limit);

  const read = await readPublicProposal(String(token ?? ""), now, opts.db);
  if (read.status !== "ok") return fail(read.status === "unavailable" || read.status === "unconfigured" ? PDF_MESSAGES.unavailable : PDF_MESSAGES.not_open);
  if (read.handle.storedStatus !== "sent") return fail(PDF_MESSAGES.not_open);
  const letter = read.view.letter;
  const loe = read.view.content.loe;
  if (!letter || !loe || typeof loe.body !== "string") return fail(PDF_MESSAGES.not_open);

  const details = cleanSigningDetails(rawDetails);
  // A review copy needs only a name and an address (not the signature, not the tick): the same rule as the details step.
  const needed = checkSigning({ details, typedName: details.client_name, agree: true });
  if (!needed.ok) return fail(PDF_MESSAGES.details);

  const picked = normalizeSelection(read.view.content, selection);
  const priced = quoteWithClientClasses(read.view.content, picked, parseClientClassInput(read.view.content, clientClasses), { repair: true });
  if (!priced.ok) return fail(PDF_MESSAGES.unavailable);

  const exhibit = buildExhibit(priced.content, priced.quote, money);
  const assembled = assembleAgreement({
    body: loe.body,
    inputs: { details, typedName: details.client_name, dateText: letterDateText(now, read.view.firm.timeZone), clientEmail: letter.clientEmail },
    exhibit,
  });
  if (!assembled.ok) return fail(PDF_MESSAGES.unavailable);

  try {
    // Counted only once a PDF is really being made, so a refused call does not use a slot.
    reviewTokenLimiter.record(tokenKey);
    reviewAddressLimiter.record(ipKey);
    const bytes = await buildLetterPdf({
      blocks: assembled.agreement.blocks,
      exhibit,
      details,
      mode: "review",
      firmName: read.view.firm.displayName,
      title: loe.title,
    });
    return { ok: true, base64: Buffer.from(bytes).toString("base64"), filename: filenameFor(details.client_name, false) };
  } catch {
    return fail(PDF_MESSAGES.unavailable);
  }
}

export async function signedLetterPdf(token: string, now: Date, opts: { db?: PublicProposalsDb } = {}): Promise<LetterPdfResult> {
  const read = await readPublicProposal(String(token ?? ""), now, opts.db);
  if (read.status !== "ok") return fail(read.status === "unavailable" || read.status === "unconfigured" ? PDF_MESSAGES.unavailable : PDF_MESSAGES.not_open);
  const signed = read.view.letter?.signed;
  if (read.handle.storedStatus !== "accepted" || !signed) return fail(PDF_MESSAGES.not_signed);
  try {
    const bytes = await buildLetterPdf({
      blocks: signed.blocks,
      exhibit: signed.exhibit,
      details: signed.details,
      mode: "signed",
      signature: { signerName: signed.signerName, signedAtText: signed.signedAtText, fingerprint: signed.fingerprint, signatureId: signed.signatureId },
      firmName: read.view.firm.displayName,
      title: read.view.content.loe?.title ?? "Engagement letter",
    });
    return { ok: true, base64: Buffer.from(bytes).toString("base64"), filename: filenameFor(signed.details.client_name, true) };
  } catch {
    return fail(PDF_MESSAGES.unavailable);
  }
}

