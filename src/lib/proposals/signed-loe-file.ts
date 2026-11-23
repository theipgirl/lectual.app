import { notReadyYet } from "@/lib/ui/words";
import { FILES_BUCKET, buildStoragePath, type FileParentKind } from "@/lib/files/rules";
import { isMissingTableError, isBucketMissingError } from "@/lib/files/errors";
import { SignedUploadBlocked } from "./loe-signed-upload";
import { STEP_TEXT } from "./step-text";

/**
 * Filing the SIGNED engagement letter in Lectual (Documents & files) under the proposal's lead or matter: the step
 * `signed_loe_file`, success word `filed` (Sprint B, lectual 0117; owner decision 4). A LINK signature only (Q5: the in-app
 * signed copy is not filed here until the owner answers).
 *
 * The pure core: every dependency is passed in, so the order, the outcomes and the cleanup are tested with fakes. It never throws and
 * never logs. Nothing of the letter, the signer's details or the bytes is put in a reason.
 *
 * Outcomes: `filed`; `skipped` (Documents & files isn't switched on: the table or bucket is missing, judged by code, so the next
 * run or Try again files it once it is); `blocked` (no lead or matter, or the stored signed text doesn't match its fingerprint);
 * `failed` (the lead/matter couldn't be read, the PDF couldn't be built, the object or the row couldn't be written).
 * An object written but a row refused: the object is removed (best effort) and the step is `failed`.
 *
 * SERVICE ROLE ON THE PUBLIC PATH (a documented exception to "Documents & files has no service role"): when the client signs by
 * link there is no session, so the follow-up run writes the `client-files` object, the `crm_file` row and the `file_uploaded`
 * activity through the service-role client it is handed, fenced on the PROPOSAL ROW'S `org_id`, the path built by
 * `buildStoragePath` from that org. This file imports no admin client; the client is a parameter. The staff Try again runs the same
 * core on the caller's SCOPED client.
 */

export type SignedFileResult = { outcome: "filed" | "skipped" | "blocked" | "failed"; reason?: string; extra?: Record<string, string> };

export type FilingTarget = { ok: true; kind: FileParentKind; id: string } | { ok: false; kind: "blocked" | "failed"; reason: string };

export type WriteResult = "ok" | "not_set_up" | "failed";

export type FilingStore = {
  /** Writes the object at `path` with content type application/pdf. */
  put: (path: string, bytes: Uint8Array) => Promise<WriteResult>;
  /** Best effort. */
  remove: (path: string) => Promise<void>;
  insertFile: (row: { id: string; org_id: string; lead_id: string | null; matter_id: string | null; storage_path: string; file_name: string; mime: "application/pdf"; size_bytes: number }) => Promise<WriteResult>;
  /** The timeline row. A failure is the caller's to log; it never changes the outcome. */
  logActivity: (row: { org_id: string; lead_id: string | null; matter_id: string | null; type: "file_uploaded"; actor_type: "system"; payload: { file_id: string; source: "signed_letter" } }) => Promise<void>;
};

export type SignedFileDeps = {
  /** The proposal row's own org: the first path segment and the row's `org_id`. */
  orgId: string;
  target: () => Promise<FilingTarget>;
  /** The signed letter as PDF bytes (`buildVerifiedSignedPdf`); throws `SignedUploadBlocked` for a mismatch, anything else for "not built". */
  buildPdf: () => Promise<Uint8Array>;
  store: FilingStore;
  fileName: string;
  newId: () => string;
};

export async function runSignedLoeFile(deps: SignedFileDeps): Promise<SignedFileResult> {
  try {
    const target = await deps.target();
    if (!target.ok) return { outcome: target.kind, reason: target.reason };

    let bytes: Uint8Array;
    try {
      bytes = await deps.buildPdf();
    } catch (err) {
      if (err instanceof SignedUploadBlocked) return { outcome: "blocked", reason: STEP_TEXT.fileMismatch };
      return { outcome: "failed", reason: STEP_TEXT.fileNotBuilt };
    }

    const fileId = deps.newId();
    const path = buildStoragePath({ orgId: deps.orgId, kind: target.kind, parentId: target.id, fileId, ext: "pdf" });
    const put = await deps.store.put(path, bytes);
    if (put === "not_set_up") return { outcome: "skipped", reason: notReadyYet("Documents & files") };
    if (put === "failed") return { outcome: "failed", reason: STEP_TEXT.fileFailed };

    const row = {
      id: fileId,
      org_id: deps.orgId,
      lead_id: target.kind === "lead" ? target.id : null,
      matter_id: target.kind === "matter" ? target.id : null,
      storage_path: path,
      file_name: deps.fileName,
      mime: "application/pdf" as const,
      size_bytes: bytes.byteLength,
    };
    const inserted = await deps.store.insertFile(row);
    if (inserted !== "ok") {
      await deps.store.remove(path).catch(() => {});
      return inserted === "not_set_up" ? { outcome: "skipped", reason: notReadyYet("Documents & files") } : { outcome: "failed", reason: STEP_TEXT.fileFailed };
    }

    // The row is the file; the activity is its timeline entry. A failed activity write changes nothing.
    await deps.store
      .logActivity({ org_id: deps.orgId, lead_id: row.lead_id, matter_id: row.matter_id, type: "file_uploaded", actor_type: "system", payload: { file_id: fileId, source: "signed_letter" } })
      .catch(() => {});
    return { outcome: "filed", extra: { file_id: fileId } };
  } catch {
    return { outcome: "failed", reason: STEP_TEXT.fileFailed };
  }
}

/** The structural slice of a Supabase client the store needs: the service-role client, the scoped client and a test fake all fit. */
export type FilingClient = {
  from(table: string): { insert(row: unknown): PromiseLike<{ error: { code?: string; message?: string; statusCode?: string | number } | null }> };
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: { code?: string; message?: string; statusCode?: string | number } | null }>;
      remove(paths: string[]): PromiseLike<{ error: unknown }>;
    };
  };
};

/** The store over a client. `uploaded_by` and `contact_id` are never sent (no grant; the row's own default). Codes only are judged. */
export function filingStoreFor(client: FilingClient): FilingStore {
  return {
    async put(path, bytes) {
      const { error } = await client.storage.from(FILES_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (!error) return "ok";
      return isBucketMissingError(error) ? "not_set_up" : "failed";
    },
    async remove(path) {
      await client.storage.from(FILES_BUCKET).remove([path]);
    },
    async insertFile(row) {
      const { error } = await client.from("crm_file").insert(row);
      if (!error) return "ok";
      return isMissingTableError(error) ? "not_set_up" : "failed";
    },
    async logActivity(row) {
      await client.from("crm_activity").insert(row);
    },
  };
}
