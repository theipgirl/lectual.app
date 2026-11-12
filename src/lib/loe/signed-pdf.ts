import "server-only";

import { firmCivilDate } from "@/lib/quotes/firm-time";
import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import type { Exhibit } from "./exhibit";
import { agreementTextSha256 } from "./fingerprint";
import { buildLetterPdf } from "./pdf";
import { rebuildSignedLetter, signedLetterText } from "./signed-letter";
import { cleanSigningDetails, signedAtText, signedAtUtcIso } from "./signing";

export { rebuiltTextMatches } from "./signed-text-check";

/**
 * The signed letter as a PDF. ONE function builds every copy: the client's own download, the staff Download and the file filed in
 * Lawmatics all call `buildVerifiedSignedPdf`, so they carry the same text. Logs nothing; the letter is privileged content.
 *
 * ── A FINGERPRINT IS NEVER PRINTED BESIDE TEXT IT DOES NOT MATCH ─────────────────────────────────────────────────────────
 * The stored sha256 covers the exact text that was signed. This file rebuilds that text from the accepted snapshot with TODAY'S
 * code, hashes it and compares:
 *   - equal: the letter is drawn as before (bold lead-ins, the exhibit as a table) and the stored fingerprint is printed;
 *   - different (the rendering code changed since the signing): the PDF is built from the STORED signed text itself
 *     (`client_proposal_signature.agreement_text`), verbatim, as plain paragraphs. That text is hashed too and must equal the
 *     stored fingerprint, which is then printed. `fromStoredText` tells the caller, so staff are told which copy they hold;
 *   - the stored text can't be read, or doesn't hash to the stored fingerprint: NO file. Never a fingerprint beside other text.
 *
 * The firm's name and zone are required: a failed read of either is the caller's to report, never a letter with no letterhead
 * or a time in a guessed zone.
 */

/** The stored signed text and its stored sha256 (the signature row), or null when it couldn't be read or isn't there. */
export type StoredAgreement = { text: string; sha256: string };

export type SignedPdfBuild =
  | { ok: true; bytes: Uint8Array; /** True when the file was produced from the stored signed text, not rebuilt. */ fromStoredText: boolean; signerName: string; signedAt: string }
  | { ok: false };

export type SignedPdfInput = {
  snapshot: AcceptedSnapshot | null | undefined;
  /** The firm's letterhead name and zone, from a read that WORKED. An empty name or zone builds nothing. */
  firm: { displayName: string; timeZone: string };
  /** Reads the stored signed text. Called ONLY when the rebuilt text does not match the stored fingerprint. */
  readStored: () => Promise<StoredAgreement | null>;
};

/** Never drawn: the stored-text copy has no exhibit table (its exhibit lines are part of the stored text). */
const NO_EXHIBIT: Exhibit = { title: "", groups: [], legalDue: { label: "", note: "", amount: "" }, usptoDue: null };

export async function buildVerifiedSignedPdf(input: SignedPdfInput): Promise<SignedPdfBuild> {
  const { snapshot, firm } = input;
  if (!isSignedSnapshot(snapshot) || !snapshot?.agreement) return { ok: false };
  if (!firm.displayName.trim() || !firm.timeZone.trim()) return { ok: false };
  const agreement = snapshot.agreement;
  const title = snapshot.content?.loe?.title ?? "Engagement letter";
  const done = (bytes: Uint8Array, fromStoredText: boolean): SignedPdfBuild => ({ ok: true, bytes, fromStoredText, signerName: agreement.signer_name, signedAt: agreement.signed_at });

  const letter = rebuildSignedLetter(snapshot, firm.timeZone);
  if (letter && agreementTextSha256(signedLetterText(letter)) === agreement.sha256) {
    const bytes = await buildLetterPdf({
      blocks: letter.blocks,
      exhibit: letter.exhibit,
      details: letter.details,
      mode: "signed",
      signature: { signerName: letter.signerName, signedAtText: letter.signedAtText, signedAtUtc: letter.signedAtUtc, fingerprint: agreement.sha256, signatureId: letter.signatureId },
      firmName: firm.displayName,
      title,
    });
    return done(bytes, false);
  }

  // Today's code does not rebuild what was signed. Fall back to the stored signed text, and only if it is what the fingerprint covers.
  let stored: StoredAgreement | null;
  try {
    stored = await input.readStored();
  } catch {
    stored = null;
  }
  if (!stored || typeof stored.text !== "string" || stored.text.length === 0) return { ok: false };
  if (stored.sha256 !== agreement.sha256 || agreementTextSha256(stored.text) !== stored.sha256) return { ok: false };
  const bytes = await buildLetterPdf({
    blocks: [],
    exhibit: NO_EXHIBIT,
    storedText: stored.text,
    details: cleanSigningDetails(snapshot.signing?.details),
    mode: "signed",
    signature: {
      signerName: agreement.signer_name,
      signedAtText: signedAtText(agreement.signed_at, firm.timeZone),
      signedAtUtc: signedAtUtcIso(agreement.signed_at),
      fingerprint: stored.sha256,
      signatureId: agreement.signature_id,
    },
    firmName: firm.displayName,
    title,
  });
  return done(bytes, true);
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
