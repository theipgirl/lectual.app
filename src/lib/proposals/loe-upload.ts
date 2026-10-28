import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { DOCX_MIME } from "@/lib/documents/accepted-proposal-docx";
import { downloadStoredDocument, getDocumentDraftByQueueItemId } from "@/lib/documents/store";
import type { DocumentDraftRow } from "@/lib/documents/types";
import { uploadMatterFile } from "@/lib/lawmatics/writes";
import { lawmaticsMatterAccess, resolveProposalMatter, signedInLawmaticsToken } from "./lawmatics-access";
import { currentRound, stepPayload } from "./paid";
import { STEP_TEXT } from "./step-text";
import { getProposalRow, listProposalStepEvents, recordProposalStep } from "./store";
import type { ProposalRow } from "./types";

/**
 * The approved engagement letter's file, on its way to the Lawmatics matter (Sprint 19).
 *
 * It uploads ONLY after a person has approved the queue item: the approval hook calls
 * `uploadApprovedLoe` once the docx is rendered and stored, and a failed upload can be
 * retried from the proposal page (`retryLoeFileUpload`, which reads the stored docx back).
 * Either way the outcome is a line on the proposal's timeline. Neither can change the
 * approval or the stored document, and neither throws.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

export type LoeUploadResult = { outcome: "uploaded" | "blocked" | "failed"; reason: string | null; recorded: boolean };

/** Uploads these bytes to the matter's Lawmatics record and writes the outcome to the proposal's timeline. */
async function uploadAndRecord(
  supabase: ScopedClient,
  proposal: ProposalRow,
  file: { matterId: string; fileName: string; bytes: Uint8Array; draftId: string },
): Promise<LoeUploadResult> {
  const matter = await resolveProposalMatter(supabase, { matter_id: file.matterId, lead_id: null });
  const access = lawmaticsMatterAccess(matter, await signedInLawmaticsToken(), "uploaded");
  let outcome: LoeUploadResult["outcome"];
  let reason: string | null = null;
  if (!access.ok) {
    outcome = "blocked";
    reason = access.reason;
  } else {
    const sent = await uploadMatterFile(access.token, { matterId: access.lawmaticsId, fileName: file.fileName, mime: DOCX_MIME, bytes: file.bytes });
    outcome = sent.ok ? "uploaded" : "failed";
    reason = sent.ok ? null : sent.reason;
  }
  const recorded = await recordProposalStep(proposal, stepPayload("loe_file_upload", outcome, reason, { draft_id: file.draftId }));
  return { outcome, reason, recorded };
}

/**
 * The approval hook's entry: a proposal-born engagement letter (its draft payload carries
 * `proposalId`) whose docx was just stored. Anything else returns without a request.
 */
export async function uploadApprovedLoe(supabase: ScopedClient, draft: Pick<DocumentDraftRow, "id" | "matter_id" | "payload">, file: { bytes: Uint8Array; fileName: string }): Promise<void> {
  const proposalId = draft.payload && typeof draft.payload.proposalId === "string" ? draft.payload.proposalId : null;
  if (!proposalId) return;
  try {
    const proposal = await getProposalRow(proposalId);
    if (!proposal) return;
    await uploadAndRecord(supabase, proposal, { matterId: draft.matter_id, fileName: file.fileName, bytes: file.bytes, draftId: draft.id });
  } catch {
    console.error("[proposals] the engagement letter upload stopped early");
  }
}

/** Retry from the proposal page: the stored docx of this proposal's queued letter, uploaded again. */
export async function retryLoeFileUpload(proposal: ProposalRow): Promise<LoeUploadResult> {
  const fail = (reason: string): LoeUploadResult => ({ outcome: "blocked", reason, recorded: false });
  try {
    const events = await listProposalStepEvents(proposal.id);
    if (!events.ok) return fail(STEP_TEXT.draftsUnreadable);
    // lectual 0101: only a letter queued in the current round (after the newest reset).
    const queued = currentRound(events.events, proposal.id)
      .map((e) => (e.payload && typeof e.payload === "object" ? (e.payload as Record<string, unknown>) : {}))
      .find((p) => p.step === "loe_draft" && p.outcome === "queued" && typeof p.queue_item_id === "string");
    if (!queued) return fail(STEP_TEXT.noDraftToRetry);

    const supabase = await getScopedClient();
    const draft = await getDocumentDraftByQueueItemId(supabase, queued.queue_item_id as string);
    if (!draft || draft.status !== "generated" || !draft.storage_path) return fail(STEP_TEXT.noStoredLoe);
    const bytes = await downloadStoredDocument(supabase, draft.storage_path);
    if (!bytes) return fail(STEP_TEXT.noStoredLoe);
    return await uploadAndRecord(supabase, proposal, { matterId: draft.matter_id, fileName: draft.file_name ?? "Engagement letter.docx", bytes, draftId: draft.id });
  } catch {
    return { outcome: "failed", reason: "unexpected error", recorded: false };
  }
}
