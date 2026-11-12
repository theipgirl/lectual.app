import "server-only";

import type { LetterPdfResult } from "./pdf-result";
import { buildVerifiedSignedPdf, signedLetterFileName, type StoredAgreement } from "./signed-pdf";
import type { StaffFirmFacts } from "./staff-firm";
import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { ProposalRow } from "@/lib/proposals/types";

/**
 * The staff Download of a signed letter: the pure body of the server action, with every dependency passed in so the refusals and the bytes
 * are tested without a database. The proposal is read through the caller's scoped client (another firm's id is simply not found, with no letter
 * data), and the file is `buildVerifiedSignedPdf(snapshot)`: the same builder as the client's own signed download and the Lawmatics
 * filing. `fromStoredText` comes back true when the file had to be produced from the stored signed text (the card then says so).
 * Returns base64 bytes and a file name, or a fixed sentence. Never raw error text; the letter and the bytes are never logged.
 */

export const STAFF_DOWNLOAD_MESSAGES = {
  not_found: "Proposal not found.",
  not_signed: "This version hasn't been signed, so there is no signed letter to download.",
  unavailable: "Couldn't build the signed letter. Try again shortly.",
  /** Not a "try again": the stored signed text does not hash to its recorded fingerprint, so no copy is made at all. */
  mismatch: "The stored signed letter doesn't match its recorded fingerprint, so no copy was made. Lectual has been told.",
} as const;

export type StaffDownloadDeps = {
  /** Module and role gate; a refusal's sentence is returned as is. */
  gate: () => Promise<{ error?: string } | null>;
  /** The proposal through the caller's scoped client; null when it isn't there for this firm. Throws when the read fails. */
  getProposal: (id: string) => Promise<ProposalRow | null>;
  firmFacts: () => Promise<StaffFirmFacts>;
  /** The stored signed text of this version (scoped client, fenced on the row's own org). Only called when the rebuilt text no longer matches. */
  readStored: (proposal: ProposalRow) => Promise<StoredAgreement | null>;
  /** Called once when the stored signed text does not match its recorded fingerprint: the caller writes the one log line (id and step only). */
  onMismatch?: (proposalId: string) => void;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runStaffDownload(deps: StaffDownloadDeps, proposalId: unknown): Promise<LetterPdfResult> {
  const refused = await deps.gate();
  if (refused?.error) return { ok: false, message: refused.error };
  const id = typeof proposalId === "string" ? proposalId.trim() : "";
  if (!ID.test(id)) return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.not_found };
  try {
    const proposal = await deps.getProposal(id);
    if (!proposal) return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.not_found };
    const snapshot = proposal.accepted_snapshot;
    if (proposal.status !== "accepted" || !isSignedSnapshot(snapshot)) return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.not_signed };
    const facts = await deps.firmFacts();
    if (facts.status !== "ok") return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
    const built = await buildVerifiedSignedPdf({
      snapshot,
      firm: { displayName: facts.displayName, timeZone: facts.timeZone, logo: facts.logo ?? null },
      readStored: () => deps.readStored(proposal),
    });
    if (!built.ok) {
      if (built.reason === "mismatch") {
        deps.onMismatch?.(proposal.id);
        return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.mismatch };
      }
      return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
    }
    return {
      ok: true,
      base64: Buffer.from(built.bytes).toString("base64"),
      filename: signedLetterFileName(built.signerName, built.signedAt, facts.timeZone),
      ...(built.fromStoredText ? { fromStoredText: true } : {}),
    };
  } catch {
    return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
  }
}
