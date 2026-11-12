import "server-only";

import type { LetterPdfResult } from "./pdf-result";
import { rebuildSignedLetter } from "./signed-letter";
import { buildSignedLetterPdf, signedLetterFileName } from "./signed-pdf";
import type { StaffFirmFacts } from "./staff-firm";
import { isSignedSnapshot } from "@/lib/proposals/signed-state";
import type { ProposalRow } from "@/lib/proposals/types";

/**
 * The staff Download of a signed letter: the pure body of the server action, with every dependency passed in so the refusals and the bytes
 * are tested without a database. The proposal is read through the caller's scoped client (another firm's id is simply not found, with no letter
 * data), and the file is `buildSignedLetterPdf` of `rebuildSignedLetter(snapshot)`: the same input as the client's own signed download.
 * Returns base64 bytes and a file name, or a fixed sentence. Never raw error text; the letter and the bytes are never logged.
 */

export const STAFF_DOWNLOAD_MESSAGES = {
  not_found: "Proposal not found.",
  not_signed: "This version hasn't been signed, so there is no signed letter to download.",
  unavailable: "Couldn't build the signed letter. Try again shortly.",
} as const;

export type StaffDownloadDeps = {
  /** Module and role gate; a refusal's sentence is returned as is. */
  gate: () => Promise<{ error?: string } | null>;
  /** The proposal through the caller's scoped client; null when it isn't there for this firm. Throws when the read fails. */
  getProposal: (id: string) => Promise<ProposalRow | null>;
  firmFacts: () => Promise<StaffFirmFacts>;
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
    const letter = rebuildSignedLetter(snapshot, facts.timeZone);
    if (!letter) return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
    const bytes = await buildSignedLetterPdf(letter, { displayName: facts.displayName, title: snapshot!.content.loe?.title ?? "Engagement letter" });
    return { ok: true, base64: Buffer.from(bytes).toString("base64"), filename: signedLetterFileName(letter.signerName, letter.signedAt, facts.timeZone) };
  } catch {
    return { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
  }
}
