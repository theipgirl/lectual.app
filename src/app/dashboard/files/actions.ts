"use server";

// "Documents & files" (lectual 0097): request an upload, confirm it, delete it.
// The browser uploads straight to storage in between, with a signed URL this file
// mints. Every call goes through the caller's scoped client (RLS and the storage
// policies on org_id): there is no service role here and no org argument anywhere.
// Nothing here sends, emails or shares a file; files are internal to the firm.

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { logActivitySafe } from "@/lib/matters/activity";
import { FILE_DELETE_ROLES, FILE_UPLOAD_ROLES } from "@/lib/files/roles";
import { isBucketMissingError, isMissingTableError, isObjectMissingError, logFileFailure } from "@/lib/files/errors";
import { authorize, loadParentOrg, parentPath, parseParent, refuse, type FileParentInput, type Refusal } from "@/lib/files/guard";
import {
  FILES_BUCKET,
  FILE_MESSAGES,
  MAX_FILE_BYTES,
  buildStoragePath,
  checkFileName,
  checkFileSize,
  isUuid,
} from "@/lib/files/rules";

export type RequestUploadResult =
  | { ok: true; fileId: string; signedUrl: string; token: string; mime: string }
  | Refusal;

export type ConfirmUploadResult = { ok: true; fileId: string; alreadySaved?: true } | Refusal;

export type DeleteFileResult = { ok: true } | Refusal;

/** A thrown error must never become a raw message on the screen or an error page. */
async function guarded<T extends { ok: boolean }>(where: string, run: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await run();
  } catch (err) {
    logFileFailure(where, err);
    return refuse(FILE_MESSAGES.generic);
  }
}

/**
 * Step 1 of an upload. Checks the session and a staff role, reads the parent
 * through the scoped client and takes org_id FROM THAT ROW, validates the type
 * and size, and returns a signed upload URL for
 * `{org_id}/{lead|matter}/{parent_id}/{file_id}.{ext}`.
 *
 * The file's extension is the single authority on its type (browsers send an
 * empty or odd MIME for .msg, .eml and .heic), so the browser's MIME is
 * advisory: it neither widens nor narrows what is accepted. The MIME returned
 * is the mapped one, and the upload must send it as its content type.
 */
export async function requestUploadAction(
  parent: FileParentInput,
  fileName: string,
  _browserMime: string,
  size: number,
): Promise<RequestUploadResult> {
  return guarded("request upload", async () => {
    const target = parseParent(parent);
    if (!target) return refuse(FILE_MESSAGES.notFound);

    const supabase = await getScopedClient();
    const who = await authorize(supabase, FILE_UPLOAD_ROLES, FILE_MESSAGES.cantUpload);
    if (!who.ok) return who;

    const org = await loadParentOrg(supabase, target);
    if (!org.ok) return org;

    const type = checkFileName(typeof fileName === "string" ? fileName : "");
    if (!type.ok) return refuse(type.error);
    const sized = checkFileSize(size);
    if (!sized.ok) return refuse(sized.error);

    const fileId = crypto.randomUUID();
    const path = buildStoragePath({ orgId: org.orgId, kind: target.kind, parentId: target.id, fileId, ext: type.ext });
    const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      if (isBucketMissingError(error)) return refuse(FILE_MESSAGES.notSetUp, { notSetUp: true });
      logFileFailure("sign upload", error);
      return refuse(FILE_MESSAGES.generic);
    }
    return { ok: true as const, fileId, signedUrl: data.signedUrl, token: data.token, mime: type.mime };
  }) as Promise<RequestUploadResult>;
}

/**
 * Step 3, after the browser's direct upload. Takes no path, org or MIME from the
 * browser: it re-reads the parent, rebuilds the path from the parent row and the
 * file id step 1 issued, re-derives the type from the name, and confirms through
 * the scoped storage client that the object is really there (storing its real
 * size). Then it inserts the crm_file row and logs a `file_uploaded` activity.
 */
export async function confirmUploadAction(parent: FileParentInput, fileId: string, fileName: string): Promise<ConfirmUploadResult> {
  return guarded("confirm upload", async () => {
    const target = parseParent(parent);
    if (!target) return refuse(FILE_MESSAGES.notFound);
    if (!isUuid(fileId)) return refuse(FILE_MESSAGES.badUpload);

    const supabase = await getScopedClient();
    const who = await authorize(supabase, FILE_UPLOAD_ROLES, FILE_MESSAGES.cantUpload);
    if (!who.ok) return who;

    const org = await loadParentOrg(supabase, target);
    if (!org.ok) return org;

    const type = checkFileName(typeof fileName === "string" ? fileName : "");
    if (!type.ok) return refuse(type.error);

    const path = buildStoragePath({ orgId: org.orgId, kind: target.kind, parentId: target.id, fileId, ext: type.ext });
    const objectName = `${fileId}.${type.ext}`;
    const bucket = supabase.storage.from(FILES_BUCKET);

    const listed = await bucket.list(path.slice(0, path.lastIndexOf("/")), { search: objectName, limit: 10 });
    if (listed.error) {
      if (isBucketMissingError(listed.error)) return refuse(FILE_MESSAGES.notSetUp, { notSetUp: true });
      logFileFailure("find uploaded object", listed.error);
      return refuse(FILE_MESSAGES.generic);
    }
    const stored = (listed.data ?? []).find((o) => o.name === objectName);
    if (!stored) return refuse(FILE_MESSAGES.badUpload);
    const sizeBytes = (stored.metadata as { size?: unknown } | null)?.size;
    if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0) return refuse(FILE_MESSAGES.generic);
    if (sizeBytes > MAX_FILE_BYTES) return refuse(FILE_MESSAGES.tooBig);

    // uploaded_by is not sent (no INSERT grant; it takes auth.uid()), nor contact_id, nor created_at.
    const { error: insertError } = await supabase.from("crm_file").insert({
      id: fileId,
      org_id: org.orgId,
      lead_id: target.kind === "lead" ? target.id : null,
      matter_id: target.kind === "matter" ? target.id : null,
      storage_path: path,
      file_name: type.name,
      mime: type.mime,
      size_bytes: sizeBytes,
    });
    if (insertError) {
      // The unique path (or id) means this exact file is already on the record.
      if (insertError.code === "23505") return { ok: true as const, fileId, alreadySaved: true as const };
      logFileFailure("save file row", insertError);
      // A staff role cannot delete in storage, so this can leave an unreferenced object. Best effort only.
      await bucket.remove([path]).catch((err: unknown) => logFileFailure("clean up object", err));
      if (isMissingTableError(insertError)) return refuse(FILE_MESSAGES.notSetUp, { notSetUp: true });
      return refuse(FILE_MESSAGES.saveFailed);
    }

    // The row is the file; the activity is its timeline entry. A failed activity write is logged, never shown.
    await logActivitySafe({
      type: "file_uploaded",
      leadId: target.kind === "lead" ? target.id : undefined,
      matterId: target.kind === "matter" ? target.id : undefined,
      actorType: "user",
      payload: { file_id: fileId, file_name: type.name, size_bytes: sizeBytes },
    });
    revalidatePath(parentPath(target));
    return { ok: true as const, fileId };
  }) as Promise<ConfirmUploadResult>;
}

/**
 * Deletes a stored file: owner, admin and senior_admin only, role resolved on
 * every call. The object is removed FIRST and the row second, so a failed removal
 * keeps the row (the file stays listed and can be tried again) and a failed row
 * delete after the object is gone says so (a retry succeeds, because an object
 * that is already gone counts as removed).
 */
export async function deleteFileAction(fileId: string): Promise<DeleteFileResult> {
  return guarded("delete file", async () => {
    if (!isUuid(fileId)) return refuse(FILE_MESSAGES.fileNotFound);

    const supabase = await getScopedClient();
    const who = await authorize(supabase, FILE_DELETE_ROLES, FILE_MESSAGES.cantDelete);
    if (!who.ok) return who;

    // Another firm's file id is no row at all under RLS.
    const { data: row, error: readError } = await supabase
      .from("crm_file")
      .select("id, org_id, lead_id, matter_id, storage_path")
      .eq("id", fileId)
      .maybeSingle();
    if (readError) {
      if (isMissingTableError(readError)) return refuse(FILE_MESSAGES.notSetUp, { notSetUp: true });
      logFileFailure("read file row", readError);
      return refuse(FILE_MESSAGES.generic);
    }
    if (!row) return refuse(FILE_MESSAGES.fileNotFound);
    // The row's own path, and only ever inside the row's own org folder.
    if (!row.storage_path || row.storage_path.split("/")[0] !== row.org_id) return refuse(FILE_MESSAGES.generic);

    const removed = await supabase.storage.from(FILES_BUCKET).remove([row.storage_path]);
    if (removed.error && !isObjectMissingError(removed.error) && !isBucketMissingError(removed.error)) {
      logFileFailure("remove object", removed.error);
      return refuse(FILE_MESSAGES.deleteKept);
    }

    const { data: deleted, error: deleteError } = await supabase.from("crm_file").delete().eq("id", fileId).select("id");
    if (deleteError || !deleted || deleted.length === 0) {
      if (deleteError) logFileFailure("delete file row", deleteError);
      return refuse(FILE_MESSAGES.deleteRowKept);
    }

    const parent = row.lead_id ? { kind: "lead" as const, id: row.lead_id } : row.matter_id ? { kind: "matter" as const, id: row.matter_id } : null;
    if (parent) revalidatePath(parentPath(parent));
    return { ok: true as const };
  }) as Promise<DeleteFileResult>;
}
