import type { InternalMail } from "@/lib/mail/internal-mail";
import { renderEmailWords, type SigningWords } from "../signing-words";

/**
 * The signing-link email, built from the firm attorney's APPROVED words only (Sprint A item 10). Pure. The subject and body are
 * the approved `link_subject` / `link_body` with their merge fields filled in one pass; builders add no sentence of their own.
 * Text only. `to` is the request's `sent_to` (the proposal row's own client email, never an address from the browser); `from`
 * is the firm's own `FIRM_CLIENT_MAIL_FROM` entry. The attachment is the review PDF built from the request's STORED text.
 */

export type LinkEmailInput = {
  words: Pick<SigningWords, "link_subject" | "link_body">;
  /** `<firm origin>/p/<token>/?sign=<signing token>`, built by the caller through `clientLinkUrl` only. */
  signingLink: string;
  clientName: string;
  firmName: string;
  /** The link's last day as text, in the firm's zone. */
  linkExpires: string;
  to: string;
  from: string;
  apiKey: string;
  pdf: Uint8Array;
  signerName: string;
  requestId: string;
};

export function reviewPdfFileName(signerName: string): string {
  const slug = signerName
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug ? `${slug}-` : ""}engagement-letter-review.pdf`;
}

/** The signing link: the proposal link (built only by `clientLinkUrl`) with the signing token as `?sign=`. */
export function signingLinkUrl(proposalUrl: string, signToken: string): string {
  return `${proposalUrl}?sign=${encodeURIComponent(signToken)}`;
}

export function buildLinkEmail(input: LinkEmailInput): InternalMail | null {
  const values = { signing_link: input.signingLink, client_name: input.clientName, firm_name: input.firmName, link_expires: input.linkExpires };
  const subject = renderEmailWords(input.words.link_subject, values);
  const body = renderEmailWords(input.words.link_body, values);
  if (!subject.ok || !body.ok) return null;
  // One line, whatever a merged value held.
  const oneLine = subject.text.replace(/[\r\n]+/g, " ").trim();
  if (!oneLine || !body.text.trim()) return null;
  return {
    apiKey: input.apiKey,
    from: input.from,
    to: [input.to],
    subject: oneLine,
    text: body.text,
    label: "signing-link",
    idempotencyKey: `signing-link:${input.requestId}`,
    attachments: [{ filename: reviewPdfFileName(input.signerName), content: input.pdf, contentType: "application/pdf" }],
  };
}
