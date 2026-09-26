import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getQueueItem } from "@/lib/queue/api";
import { logActivity } from "@/lib/matters/activity";
import { renderDocumentDocx } from "./docx";
import {
  MATTER_DOCUMENTS_BUCKET,
  getDocumentDraftByQueueItemId,
  markDocumentGenerated,
  markDocumentFailed,
} from "./store";
import { DOCUMENT_QUEUE_TYPES } from "./types";

/**
 * Runs after a queue item is approved (src/app/(firm)/dashboard/queue/actions.ts)
 * and, if it was a Document Center draft, renders the REVIEWED text into a
 * real .docx and stores it. This is the MVP shape the plan doc calls for:
 * the queue draft holds reviewable text for a fast review pass; approving is
 * what turns it into a real file.
 *
 * BEST-EFFORT BY DESIGN: the approval itself already succeeded by the time
 * this runs. A docx-rendering or storage failure must never be presented as
 * "the approval failed" — every caller wraps this in try/catch and this
 * function additionally never throws itself, so a bug here degrades to "the
 * approved text is visible in the queue, but Document Center has no file
 * yet" rather than blocking the approval flow. Failures are recorded on the
 * crm_document_draft row (status='failed', error_message) so they're
 * diagnosable, not silent.
 */
export async function generateApprovedDocument(orgKey: string, queueItemId: string): Promise<void> {
  try {
    const supabase = await getScopedClient();
    const draft = await getDocumentDraftByQueueItemId(supabase, queueItemId);
    // Not a Document Center draft (an ordinary email/reminder/etc.) — nothing to do.
    if (!draft) return;

    const item = await getQueueItem(orgKey, queueItemId);
    if (!DOCUMENT_QUEUE_TYPES.has(item.type)) return;
    if (item.status !== "approved") return; // only render on a genuine approval

    const content = item.final_body ?? item.draft_body;

    try {
      const { buffer, fileName } = await renderDocumentDocx(draft, content);
      const path = `${draft.org_id}/${draft.matter_id}/${draft.id}.docx`;
      // No upsert: like voice-notes (0036), a generated document is immutable
      // once attached — there is no storage UPDATE policy for this bucket, by
      // design, and the path (keyed on this draft's own id) is never written
      // to twice in the current flow.
      const { error: uploadError } = await supabase.storage
        .from(MATTER_DOCUMENTS_BUCKET)
        .upload(path, buffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      if (uploadError) throw uploadError;

      await markDocumentGenerated(supabase, draft.id, { storagePath: path, fileName });
      await logActivity({
        type: "document_generated",
        matterId: draft.matter_id,
        actorType: "user",
        payload: {
          doc_type: draft.doc_type,
          storage_path: path,
          file_name: fileName,
          queue_item_id: queueItemId,
        },
      }).catch((err) => {
        // The file is already stored; a timeline note is a nice-to-have, not
        // the source of truth (crm_document_draft is). Log, don't fail the
        // generation over it.
        console.error(`[document-center] activity log failed for draft ${draft.id}`, err);
      });
    } catch (err) {
      console.error(`[document-center] docx generation failed for draft ${draft.id}`, err);
      await markDocumentFailed(
        supabase,
        draft.id,
        err instanceof Error ? err.message : String(err),
      ).catch(() => {});
    }
  } catch (err) {
    // Defense in depth: getScopedClient()/getDocumentDraftByQueueItemId/
    // getQueueItem failures (including a test suite's mock not implementing
    // one of them) must never propagate into the approval flow.
    console.error(`[document-center] approve hook failed for queue item ${queueItemId}`, err);
  }
}
