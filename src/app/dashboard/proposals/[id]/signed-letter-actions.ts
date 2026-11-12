"use server";

import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { runStaffDownload } from "@/lib/loe/staff-download";
import { loadStaffFirmFacts } from "@/lib/loe/staff-firm";
import { getProposalRow } from "@/lib/proposals/store";
import { gateStaffAction } from "../gate";

/**
 * "Download the signed letter (PDF)" on a signed version's staff page. Its own POST entry point: `gateStaffAction` first (the proposals
 * module with notFound(), then a proposal-writing role, so a viewer or social media gets nothing), then the proposal is read through the
 * caller's scoped client. The file is built by the one PDF builder from the accepted snapshot. Returns bytes (base64) saved by the browser
 * through a Blob link, like the client's own download; never raw error text.
 */
export async function downloadSignedLetterStaffAction(proposalId: string): Promise<LetterPdfResult> {
  return runStaffDownload({ gate: gateStaffAction, getProposal: getProposalRow, firmFacts: loadStaffFirmFacts }, proposalId);
}
