import "server-only";

import { firmCivilDate } from "@/lib/quotes/firm-time";
import { buildLetterPdf } from "./pdf";
import type { SignedLetter } from "./signed-letter";

/**
 * The signed letter as a PDF, for every reader that is not the client's own page: the staff Download and the file filed in
 * Lawmatics. Built ONLY by `buildLetterPdf` (mode `signed`) from `rebuildSignedLetter`'s output, the same input the client's
 * own signed download uses, so the three files carry the same text. Logs nothing; the letter is privileged content.
 */
export async function buildSignedLetterPdf(letter: SignedLetter, firm: { displayName: string; title: string }): Promise<Uint8Array> {
  return buildLetterPdf({
    blocks: letter.blocks,
    exhibit: letter.exhibit,
    details: letter.details,
    mode: "signed",
    signature: { signerName: letter.signerName, signedAtText: letter.signedAtText, fingerprint: letter.fingerprint, signatureId: letter.signatureId },
    firmName: firm.displayName,
    title: firm.title,
  });
}

/** "alex-sample-engagement-letter-signed-2026-11-12.pdf": the signer and the signed date in the firm's zone. */
export function signedLetterFileName(signerName: string, signedAtIso: string, timeZone: string): string {
  const slug = signerName
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const at = new Date(signedAtIso);
  const day = Number.isNaN(at.getTime()) ? "" : firmCivilDate(at, timeZone);
  return `${slug ? `${slug}-` : ""}engagement-letter-signed${day ? `-${day}` : ""}.pdf`;
}
