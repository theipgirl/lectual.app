import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { agreementTextSha256 } from "./fingerprint";
import { rebuildSignedLetter, signedLetterText, type SignedLetter } from "./signed-letter";

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

/** The stored signed text and its stored sha256 (the signature row). */
export type StoredAgreement = { text: string; sha256: string };

/**
 * The ONE verification of a signed letter, used by everything that shows or files one: the three PDFs (`buildVerifiedSignedPdf`)
 * and the client's on-page "Read it again" (`readPublicProposal`). Nothing is ever shown as "the signed letter", and no fingerprint
 * is ever printed, unless the text was hashed here and matched the stored sha256.
 *
 *   rebuilt      today's code rebuilds exactly the text that was signed (its sha256 equals the snapshot's);
 *   stored       it does not, but the STORED signed text does (it hashes to its own recorded sha256, which is the snapshot's);
 *   mismatch     the stored text was read and does NOT hash to its recorded fingerprint (or is not the signature the snapshot
 *                records). This is an integrity problem, not a hiccup: trying again cannot help, and callers say so to staff,
 *                record the filing as blocked and write one log line (proposal id and step, never content);
 *   unavailable  not a signed snapshot, or the rebuild did not match and the stored text could not be read (try again).
 *
 * `readStored` is called only when the rebuild does not match.
 */
export type SignedCopy =
  | { kind: "rebuilt"; letter: SignedLetter }
  | { kind: "stored"; stored: StoredAgreement }
  | { kind: "mismatch" }
  | { kind: "unavailable" };

export async function verifySignedCopy(
  snapshot: AcceptedSnapshot | null | undefined,
  timeZone: string,
  readStored: () => Promise<StoredAgreement | null>,
): Promise<SignedCopy> {
  if (!isSignedSnapshot(snapshot) || !snapshot?.agreement) return { kind: "unavailable" };
  const recorded = snapshot.agreement.sha256;
  const letter = rebuildSignedLetter(snapshot, timeZone);
  if (letter && agreementTextSha256(signedLetterText(letter)) === recorded) return { kind: "rebuilt", letter };

  let stored: StoredAgreement | null;
  try {
    stored = await readStored();
  } catch {
    stored = null;
  }
  if (!stored || typeof stored.text !== "string" || typeof stored.sha256 !== "string") return { kind: "unavailable" };
  if (stored.text.length === 0 || stored.sha256 !== recorded || agreementTextSha256(stored.text) !== stored.sha256) return { kind: "mismatch" };
  return { kind: "stored", stored };
}
