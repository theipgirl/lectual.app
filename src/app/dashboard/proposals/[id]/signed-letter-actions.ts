"use server";

import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { runStaffDownload } from "@/lib/loe/staff-download";
import { loadStaffFirmFacts } from "@/lib/loe/staff-firm";
import { getScopedClient } from "@/lib/db/scoped-client";
import { readStoredAgreement, type StoredAgreementDb } from "@/lib/loe/stored-agreement";
import { logSignedMismatch } from "@/lib/proposals/signed-mismatch-log";
import { getProposalRow } from "@/lib/proposals/store";
import { gateSignedLetterDownload } from "../gate";

/**
 * "Download the signed letter (PDF)" on a signed version's staff page. Its own POST entry point: `gateSignedLetterDownload` first (the
 * proposals module with notFound(), then a role that may read signature records, `SIGNATURE_READ_ROLES`, so a viewer or social media gets
 * nothing), then the proposal is read through the caller's scoped client. The file is built by the one signed-PDF builder, which checks the
 * rebuilt text against the stored fingerprint and otherwise uses the stored signed text. Returns bytes (base64) saved by the browser through
 * a Blob link, like the client's own download; never raw error text.
 */
export async function downloadSignedLetterStaffAction(proposalId: string): Promise<LetterPdfResult> {
  return runStaffDownload(
    {
      gate: gateSignedLetterDownload,
      getProposal: getProposalRow,
      firmFacts: loadStaffFirmFacts,
      readStored: async (proposal) =>
        readStoredAgreement((await getScopedClient()) as unknown as StoredAgreementDb, {
          proposalId: proposal.id,
          orgId: proposal.org_id,
          signatureId: proposal.accepted_snapshot?.agreement?.signature_id,
        }),
      onMismatch: (id) => logSignedMismatch(id, "staff_download"),
    },
    proposalId,
  );
}
