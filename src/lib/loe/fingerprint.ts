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
