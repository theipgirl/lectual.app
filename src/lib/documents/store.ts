import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { requireMatterWriteRole } from "@/lib/matters/matters";
import type { Json } from "@/lib/db/types";
import type { DocType, DocumentDraftRow } from "./types";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

export const MATTER_DOCUMENTS_BUCKET = "matter-documents";

/** Same staff gate as writing a matter (src/lib/matters/matters.ts) — who may
 * generate a document for a matter is who may edit that matter. */
export async function requireDocumentWriteRole(supabase: ScopedClient) {
  return requireMatterWriteRole(supabase);
}

export type CreateDocumentDraftInput = {
  matterId: string;
  orgId: string;
  docType: DocType;
  payload: Record<string, unknown>;
};

/**
 * Creates the pre-queue bookkeeping row: status='queued', queue_item_id
 * null. The caller (src/lib/documents/generate.ts) fills queue_item_id in a
 * second write once the lawmatics-mcp POST succeeds — a draft that never
 * reaches the queue is deleted, never left dangling with a null id.
 */
export async function createDocumentDraft(
  supabase: ScopedClient,
  input: CreateDocumentDraftInput,
): Promise<DocumentDraftRow> {
  const { data, error } = await supabase
    .from("crm_document_draft")
    .insert({
      matter_id: input.matterId,
      org_id: input.orgId,
      doc_type: input.docType,
      payload: input.payload as Json,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as DocumentDraftRow;
}

/** Attaches the queue item id once the draft has actually been queued. */
export async function attachQueueItemId(
  supabase: ScopedClient,
  draftId: string,
  queueItemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("crm_document_draft")
    .update({ queue_item_id: queueItemId, updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw error;
}

/** Removes a draft row that never made it to the queue (the POST failed) —
 * this table exists to describe a queue item, so a row with no queue item and
 * no chance of getting one is not history, it's litter. */
export async function deleteDocumentDraft(supabase: ScopedClient, draftId: string): Promise<void> {
  await supabase.from("crm_document_draft").delete().eq("id", draftId);
}

/** Looks up the draft a queue item was created from (the approval hook's
 * entry point). Returns null for any queue item this table doesn't know
 * about — an ordinary email/reminder draft, or a cross-tenant id RLS hides. */
export async function getDocumentDraftByQueueItemId(
  supabase: ScopedClient,
  queueItemId: string,
): Promise<DocumentDraftRow | null> {
  const { data, error } = await supabase
    .from("crm_document_draft")
    .select("*")
    .eq("queue_item_id", queueItemId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as DocumentDraftRow | null) ?? null;
}

export async function markDocumentGenerated(
  supabase: ScopedClient,
  draftId: string,
  fields: { storagePath: string; fileName: string },
): Promise<void> {
  const { error } = await supabase
    .from("crm_document_draft")
    .update({
      status: "generated",
      storage_path: fields.storagePath,
      file_name: fields.fileName,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", draftId);
  if (error) throw error;
}

export async function markDocumentFailed(
  supabase: ScopedClient,
  draftId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("crm_document_draft")
    .update({
      status: "failed",
      error_message: message.slice(0, 4000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId);
}

/** Every document ever generated (or attempted) for one matter, newest first
 * — what the Document Center's per-matter view lists. */
export async function listDocumentsForMatter(
  supabase: ScopedClient,
  matterId: string,
): Promise<DocumentDraftRow[]> {
  const { data, error } = await supabase
    .from("crm_document_draft")
    .select("*")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as DocumentDraftRow[] | null) ?? [];
}

/** Every GENERATED document across the org, newest first — the Document
 * Center's landing view before a matter is picked. */
export async function listGeneratedDocuments(supabase: ScopedClient): Promise<DocumentDraftRow[]> {
  const { data, error } = await supabase
    .from("crm_document_draft")
    .select("*")
    .eq("status", "generated")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as DocumentDraftRow[] | null) ?? [];
}

/** Short-lived signed download URL for a generated document, minted through
 * the caller's own scoped client — same pattern as
 * src/lib/voice/notes.ts's voiceNotePlaybackUrls, so the matter_documents_
 * select_own storage policy is the real gate. */
export async function documentDownloadUrl(
  supabase: ScopedClient,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MATTER_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
