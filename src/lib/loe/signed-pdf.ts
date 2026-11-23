import "server-only";

import { firmCivilDate } from "@/lib/quotes/firm-time";
import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import type { Exhibit } from "./exhibit";
import type { LetterLogo } from "./letter-logo";
import { buildLetterPdf } from "./pdf";
import { checkCertificate, type SigningCertificate } from "./email-signing/certificate";
import type { EvidenceRead } from "./email-signing/evidence";
import { cleanSigningDetails, signedAtText, signedAtUtcIso } from "./signing";

import { verifySignedCopy, type StoredAgreement } from "./signed-text-check";

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
 *   - the stored text can't be read: NO file (`unavailable`, try again);
 *   - the stored text doesn't hash to its recorded fingerprint: NO file, and a DISTINCT outcome (`mismatch`), because trying
 *     again cannot help. Never a fingerprint beside other text.
 *
 * The firm's name and zone are required: a failed read of either is the caller's to report, never a letter with no letterhead
 * or a time in a guessed zone.
 *
 * ── A LINK-SIGNED LETTER IS NEVER PRINTED WITHOUT ITS CERTIFICATE (lectual 0117, Sprint B) ───────────────────────────────
 * A snapshot signed through the EMAILED link (`agreement.method === "email_link"`) gets one more page, the signing record, built
 * from recorded evidence (`checkCertificate`). `readEvidence` is REQUIRED (no caller can leave it out), is asked only AFTER the
 * text is verified, and is never called for an in-app (0106) signature, whose bytes are exactly what they were before. Evidence
 * that is unavailable, not set up or incomplete: NO file (`unavailable`, try again). A `signed` event whose sha256 differs from
 * the verified text's, or a drawn signature that does not hash to what was recorded: NO file (`mismatch`).
 */

export type { StoredAgreement };

export type SignedPdfBuild =
  | { ok: true; bytes: Uint8Array; /** True when the file was produced from the stored signed text, not rebuilt. */ fromStoredText: boolean; signerName: string; signedAt: string }
  /**
   * `mismatch`: the stored signed text does not hash to its recorded fingerprint. No copy is made, and trying again cannot help:
   * staff are told so, the Lawmatics filing is recorded as blocked, the client gets the generic sentence. `unavailable`: anything
   * else (not signed, the stored text unreadable, the firm's name or zone missing): try again.
   */
  | { ok: false; reason: "mismatch" | "unavailable" };

export type SignedPdfInput = {
  snapshot: AcceptedSnapshot | null | undefined;
  /** The firm's letterhead name and zone, from a read that WORKED. An empty name or zone builds nothing. */
  firm: { displayName: string; timeZone: string; /** The firm's own letter logo (`letterLogoForSlug`), if it has one. */ logo?: LetterLogo | null };
  /** Reads the stored signed text. Called ONLY when the rebuilt text does not match the stored fingerprint. */
  readStored: () => Promise<StoredAgreement | null>;
  /**
   * REQUIRED. The signing evidence of an emailed-link signature (`readSigningEvidence`, bound by the caller to the client it holds,
   * fenced on the proposal row's org). Called only for an `email_link` snapshot, only after the text is verified.
   */
  readEvidence: () => Promise<EvidenceRead>;
};

/** Never drawn: the stored-text copy has no exhibit table (its exhibit lines are part of the stored text). */
const NO_EXHIBIT: Exhibit = { title: "", groups: [], legalDue: { label: "", note: "", amount: "" }, usptoDue: null };

export async function buildVerifiedSignedPdf(input: SignedPdfInput): Promise<SignedPdfBuild> {
  const { snapshot, firm } = input;
  if (!isSignedSnapshot(snapshot) || !snapshot?.agreement) return { ok: false, reason: "unavailable" };
  if (!firm.displayName.trim() || !firm.timeZone.trim()) return { ok: false, reason: "unavailable" };
  const agreement = snapshot.agreement;
  const title = snapshot.content?.loe?.title ?? "Engagement letter";
  const done = (bytes: Uint8Array, fromStoredText: boolean): SignedPdfBuild => ({ ok: true, bytes, fromStoredText, signerName: agreement.signer_name, signedAt: agreement.signed_at });

  // The one verification (`signed-text-check.ts`): what is printed was hashed and matched the stored fingerprint, or nothing is.
  const copy = await verifySignedCopy(snapshot, firm.timeZone, input.readStored);
  if (copy.kind === "mismatch") return { ok: false, reason: "mismatch" };
  if (copy.kind === "unavailable") return { ok: false, reason: "unavailable" };

  // A letter signed through the emailed link: the certificate page, from verified evidence only, or no file at all.
  let certificate: SigningCertificate | undefined;
  if (agreement.method === "email_link") {
    let read: EvidenceRead;
    try {
      read = await input.readEvidence();
    } catch {
      read = "unavailable";
    }
    if (read === "not_set_up" || read === "unavailable") return { ok: false, reason: "unavailable" };
    const checked = checkCertificate({ request: read.request, events: read.events, snapshot, verifiedSha256: agreement.sha256, tz: firm.timeZone });
    if (checked.kind === "mismatch") return { ok: false, reason: "mismatch" };
    if (checked.kind !== "ok") return { ok: false, reason: "unavailable" };
    certificate = checked.certificate;
  }

  if (copy.kind === "rebuilt") {
    const letter = copy.letter;
    const bytes = await buildLetterPdf({
      blocks: letter.blocks,
      exhibit: letter.exhibit,
      details: letter.details,
      mode: "signed",
      signature: { signerName: letter.signerName, signedAtText: letter.signedAtText, signedAtUtc: letter.signedAtUtc, fingerprint: agreement.sha256, signatureId: letter.signatureId },
      firmName: firm.displayName,
      logo: firm.logo ?? null,
      title,
      ...(certificate ? { certificate } : {}),
    });
    return done(bytes, false);
  }

  // Today's code does not rebuild what was signed: the stored signed text itself, verbatim, with the fingerprint that covers it.
  const bytes = await buildLetterPdf({
    blocks: [],
    exhibit: NO_EXHIBIT,
    storedText: copy.stored.text,
    details: cleanSigningDetails(snapshot.signing?.details),
    mode: "signed",
    signature: {
      signerName: agreement.signer_name,
      signedAtText: signedAtText(agreement.signed_at, firm.timeZone),
      signedAtUtc: signedAtUtcIso(agreement.signed_at),
      fingerprint: copy.stored.sha256,
      signatureId: agreement.signature_id,
    },
    firmName: firm.displayName,
    logo: firm.logo ?? null,
    title,
    ...(certificate ? { certificate } : {}),
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
