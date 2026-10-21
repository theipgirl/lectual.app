/**
 * The rules for "Documents & files" (lectual 0097), kept pure so the server
 * actions, the upload control in the browser and the tests all read ONE copy.
 * Nothing here touches a database, storage or the session, and nothing here
 * imports server code, so a client component may import it.
 */

export const FILES_BUCKET = "client-files";

/** The bucket's file_size_limit and the table's size CHECK: 25 MB. */
export const MAX_FILE_BYTES = 26_214_400;
export const MAX_FILE_LABEL = "25 MB";

/** crm_file_name_len: 1 to 255 characters. */
export const MAX_FILE_NAME_LENGTH = 255;

/**
 * The extension decides the type. Browsers send an empty or odd MIME for .msg,
 * .eml and .heic, so the MIME a browser claims is advisory and never widens or
 * narrows what is accepted; the MIME stored (and sent with the upload, because
 * the bucket checks that header) is the one mapped from the extension.
 *
 * The 12 values are exactly the bucket's allowed_mime_types and the crm_file
 * mime CHECK (0097); tests assert the set matches.
 */
export const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  txt: "text/plain",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};

export const ALLOWED_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_MIME);

/** The allowed types in words, shown beside the upload control. */
export const ALLOWED_TYPES_TEXT = "PDF, Word (DOCX, DOC), Excel (XLSX, XLS), CSV, PNG, JPG, HEIC, TXT, EML and MSG";

/** The `accept` attribute for the file picker. A convenience only: the server decides. */
export const FILE_PICKER_ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export type FileParentKind = "lead" | "matter";

export function isFileParentKind(value: unknown): value is FileParentKind {
  return value === "lead" || value === "matter";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Plain sentences. These (and only these) are what a person sees from a refused action.
export const FILE_MESSAGES = {
  notFound: "That record couldn't be found.",
  signedOut: "Your session has ended. Sign in again to continue.",
  roleUnknown: "Couldn't check your permissions just now. Try again shortly.",
  cantUpload: "Your role can view files but not add them.",
  cantDelete: "Only an owner or an admin can delete a file.",
  badType: `That type of file can't be stored here. Allowed types: ${ALLOWED_TYPES_TEXT}.`,
  badSize: `That file's size isn't valid. A file must have some content and be no larger than ${MAX_FILE_LABEL}.`,
  tooBig: `That file is larger than ${MAX_FILE_LABEL}, the most that can be stored here.`,
  notSetUp: "File storage isn't set up for this firm yet.",
  generic: "Couldn't complete that just now. Try again shortly.",
  badUpload: "That upload didn't arrive. Choose the file and try again.",
  alreadySaved: "That file is already saved.",
  fileNotFound: "That file couldn't be found.",
  saveFailed: "The file uploaded but couldn't be saved to this record. Try uploading it again.",
  deleteKept: "Couldn't remove that file, so nothing was deleted. Try again shortly.",
  deleteRowKept: "The stored file is gone, but its entry is still listed. Try deleting it again.",
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * The name kept on the row and offered as the download name: control characters
 * removed, path separators replaced, trimmed, at most 255 characters (the
 * extension survives a cut). The name is NEVER part of the storage path.
 */
export function cleanFileName(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(/[\\/]+/g, "_")
    .trim();
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const ext = extensionOf(cleaned);
  const tail = ext ? `.${ext}` : "";
  return `${cleaned.slice(0, MAX_FILE_NAME_LENGTH - tail.length).trimEnd()}${tail}`;
}

/** The text after the LAST dot, lower-cased; null when there is no dot, or nothing after it. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export type FileTypeCheck = { ok: true; ext: string; mime: string; name: string } | { ok: false; error: string };

/** Decides a name's type from its (cleaned) extension alone. */
export function checkFileName(rawName: string): FileTypeCheck {
  const name = cleanFileName(rawName);
  const ext = extensionOf(name);
  if (!name || !ext || !Object.hasOwn(EXTENSION_MIME, ext)) return { ok: false, error: FILE_MESSAGES.badType };
  return { ok: true, ext, mime: EXTENSION_MIME[ext], name };
}

export type FileSizeCheck = { ok: true } | { ok: false; error: string };

/** A positive whole number of bytes, at most 25 MB. */
export function checkFileSize(size: unknown): FileSizeCheck {
  if (typeof size !== "number" || !Number.isFinite(size) || !Number.isInteger(size) || size <= 0) {
    return { ok: false, error: FILE_MESSAGES.badSize };
  }
  if (size > MAX_FILE_BYTES) return { ok: false, error: FILE_MESSAGES.tooBig };
  return { ok: true };
}

export type StoragePathInput = {
  orgId: string;
  kind: FileParentKind;
  parentId: string;
  fileId: string;
  ext: string;
};

/**
 * `{org_id}/{lead|matter}/{parent_id}/{file_id}.{ext}`. The first folder is the
 * org id (the whole storage policy keys on it) and the org id comes from the
 * parent ROW. There is deliberately no argument for a file name.
 */
export function buildStoragePath({ orgId, kind, parentId, fileId, ext }: StoragePathInput): string {
  return `${orgId}/${kind}/${parentId}/${fileId}.${ext}`;
}

/** "512 B", "84 KB", "2.3 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (Math.round(kb) < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
