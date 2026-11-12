import { createHash } from "node:crypto";
import { agreementCanonical, canonicalJson, type AgreementParts } from "./canonical";

export { agreementCanonical, canonicalJson };
export type { AgreementParts };

/**
 * sha256 (hex) over a CANONICAL form of what a client is about to sign: the
 * letter, their details and the exhibit. Canonical = object keys sorted at every
 * level, no insignificant whitespace, `undefined` keys dropped; array order and
 * every character of every string count. So two objects that differ only in key
 * order or in how they were serialised agree, and changing one letter, one
 * detail or one exhibit character does not.
 *
 * Pure and deterministic. The server builds the agreement text itself and
 * compares its fingerprint with the one the browser saw; a mismatch means the
 * page was stale and nothing is written.
 */

export function agreementFingerprint(parts: AgreementParts): string {
  const canonical = agreementCanonical(parts);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * sha256 (hex) of an agreement's canonical string (`Agreement.canonical`, built by `assembleAgreement` with the date fields
 * fixed). This is what the server compares with the fingerprint the page sent: equal to the browser's Web Crypto hash of the
 * same string (`fingerprintOf`).
 */
export function canonicalFingerprint(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** sha256 (hex) of the agreement TEXT: what the signature row stores as `agreement_sha256` and the signed PDF prints. */
export function agreementTextSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
