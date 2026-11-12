import { money } from "@/components/client-proposal/format";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { buildExhibit, type Exhibit } from "./exhibit";
import type { LetterBlock } from "./render";
import { agreementText, assembleAgreement, cleanSigningDetails, signedAtText, signedAtUtcIso, signedLineText, type SignerDetails } from "./signing";

/**
 * The letter AS SIGNED, rebuilt from the accepted snapshot alone: the letter text the proposal carried when it was signed
 * (`content.loe.body`), the details and date the client signed with (`signing`), and the quote the client agreed to. Never from
 * the firm's current template or settings, so "Read it again" and the signed PDF cannot drift if the firm changes its letter
 * later. Pure and deterministic; returns null for anything that is not a schema-2 signed snapshot (every earlier acceptance).
 */

export type SignedLetter = {
  blocks: LetterBlock[];
  exhibit: Exhibit;
  details: SignerDetails;
  signerName: string;
  signedAt: string;
  /** "Signed November 12, 2026 at 2:14 PM EST by Alex Sample": the firm's zone, named. */
  signedLine: string;
  signedAtText: string;
  /** The signed instant in UTC, ISO 8601, for the PDF's signature record. */
  signedAtUtc: string;
  fingerprint: string;
  signatureId: string | null;
};

/**
 * What a reader is SHOWN as the signed letter. Either the rebuilt letter (lead-ins and Exhibit A as a table) or, when today's
 * code no longer rebuilds what was signed, the stored signed text as plain paragraphs (its exhibit lines are part of that text,
 * so there is no table: `exhibit` is null and `fromStoredText` is true). Only ever built from text that was hashed and matched
 * to the stored fingerprint (`verifySignedCopy`).
 */
export type SignedLetterView = Omit<SignedLetter, "exhibit"> & { exhibit: Exhibit | null; fromStoredText?: boolean };

/** The stored signed text as a view: one plain block per blank-line-separated paragraph, line breaks kept. Signer, time and fingerprint from the snapshot. */
export function storedSignedLetterView(snapshot: AcceptedSnapshot, stored: { text: string; sha256: string }, timeZone: string): SignedLetterView | null {
  const agreement = snapshot.agreement;
  if (!agreement) return null;
  return {
    blocks: stored.text
      .split(/\n{2,}/)
      .filter((p) => p.length > 0)
      .map((text) => ({ lead: null, text })),
    exhibit: null,
    fromStoredText: true,
    details: cleanSigningDetails(snapshot.signing?.details),
    signerName: agreement.signer_name,
    signedAt: agreement.signed_at,
    signedLine: signedLineText(agreement.signed_at, timeZone, agreement.signer_name),
    signedAtText: signedAtText(agreement.signed_at, timeZone),
    signedAtUtc: signedAtUtcIso(agreement.signed_at),
    fingerprint: stored.sha256,
    signatureId: agreement.signature_id,
  };
}

export function rebuildSignedLetter(snapshot: AcceptedSnapshot | null | undefined, timeZone: string): SignedLetter | null {
  if (!snapshot || snapshot.schema !== 2 || !snapshot.agreement || !snapshot.signing) return null;
  const body = snapshot.content?.loe?.body;
  if (typeof body !== "string" || body.length === 0) return null;
  const details = cleanSigningDetails(snapshot.signing.details);
  const exhibit = buildExhibit(snapshot.content, snapshot.quote, money);
  const rebuilt = assembleAgreement({
    body,
    inputs: {
      details,
      typedName: snapshot.agreement.signer_name,
      dateText: snapshot.signing.date_text,
      clientEmail: snapshot.signing.client_email,
    },
    exhibit,
  });
  if (!rebuilt.ok) return null;
  const line = signedLineText(snapshot.agreement.signed_at, timeZone, snapshot.agreement.signer_name);
  return {
    blocks: rebuilt.agreement.blocks,
    exhibit,
    details,
    signerName: snapshot.agreement.signer_name,
    signedAt: snapshot.agreement.signed_at,
    signedLine: line,
    signedAtText: signedAtText(snapshot.agreement.signed_at, timeZone),
    signedAtUtc: signedAtUtcIso(snapshot.agreement.signed_at),
    fingerprint: snapshot.agreement.sha256,
    signatureId: snapshot.agreement.signature_id,
  };
}

/**
 * The plain text of a rebuilt letter: every paragraph, then Exhibit A, exactly as `assembleAgreement` produced it at signing.
 * Its sha256 is what the signature row stores; `buildVerifiedSignedPdf` hashes this and compares before printing a fingerprint.
 */
export function signedLetterText(letter: Pick<SignedLetter, "blocks" | "exhibit">): string {
  return agreementText(letter.blocks, letter.exhibit);
}
