import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { agreementTextSha256 } from "./fingerprint";
import { rebuildSignedLetter, signedLetterText } from "./signed-letter";

/**
 * Does today's code rebuild exactly the text whose sha256 the accepted snapshot stores? Pure apart from the hash. False for
 * anything that is not a signed snapshot. `buildVerifiedSignedPdf` uses the same comparison to choose between the rebuilt
 * letter and the stored signed text, and the staff card uses this to say which copy the Download will be.
 */
export function rebuiltTextMatches(snapshot: AcceptedSnapshot | null | undefined): boolean {
  if (!isSignedSnapshot(snapshot)) return false;
  // The zone only shapes the signed LINE, which is not part of the hashed text.
  const letter = rebuildSignedLetter(snapshot, "UTC");
  return !!letter && agreementTextSha256(signedLetterText(letter)) === snapshot!.agreement!.sha256;
}
