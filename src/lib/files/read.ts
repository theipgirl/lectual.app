import { getScopedClient } from "@/lib/db/scoped-client";
import { DOC_TYPE_LABEL } from "@/lib/documents/list";
import { isMissingTableError, logFileFailure } from "./errors";
import type { FileParentKind } from "./rules";

/**
 * The reads behind the "Documents & files" card. Every read goes through the
 * caller's scoped client (RLS on org_id), never the service role, and none of
 * them throws. A failed read is NEVER an empty list: files and letters each
 * report their own outcome, so one failing cannot hide the other.
 */

export type FileParent = { kind: FileParentKind; id: string };

/** Each parent shows its newest 100 entries of each kind; the card says so when there are more. */
export const LIST_CAP = 100;

export type FileRow = {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
};

/** `not-set-up` = the crm_file table is not in this database (0097 not applied); `unavailable` = anything else. */
export type FilesRead =
  | { status: "ok"; files: FileRow[]; capped: boolean }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export async function listFiles(parent: FileParent): Promise<FilesRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_file")
      .select("id, file_name, mime, size_bytes, uploaded_by, created_at")
      .eq(parent.kind === "lead" ? "lead_id" : "matter_id", parent.id)
      .order("created_at", { ascending: false })
      .limit(LIST_CAP + 1);
    if (error) {
      if (isMissingTableError(error)) return { status: "not-set-up" };
      logFileFailure("list files", error);
      return { status: "unavailable" };
    }
    const rows = (data ?? []) as FileRow[];
    return { status: "ok", files: rows.slice(0, LIST_CAP), capped: rows.length > LIST_CAP };
  } catch (err) {
    logFileFailure("list files", err);
    return { status: "unavailable" };
  }
}

export type LetterRow = {
  id: string;
  doc_type: string;
  file_name: string | null;
  created_by: string | null;
  generated_at: string | null;
  created_at: string;
};

export type LettersRead = { status: "ok"; letters: LetterRow[]; capped: boolean } | { status: "unavailable" };

/**
 * A matter's generated letters (crm_document_draft). Only status "generated":
 * the download route answers 404 for any other status, so a queued or failed
 * letter has no link to offer (those stay on the Documents page).
 */
export async function listGeneratedLetters(matterId: string): Promise<LettersRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_document_draft")
      .select("id, doc_type, file_name, created_by, generated_at, created_at")
      .eq("matter_id", matterId)
      .eq("status", "generated")
      .order("created_at", { ascending: false })
      .limit(LIST_CAP + 1);
    if (error) {
      logFileFailure("list letters", error);
      return { status: "unavailable" };
    }
    const rows = (data ?? []) as LetterRow[];
    return { status: "ok", letters: rows.slice(0, LIST_CAP), capped: rows.length > LIST_CAP };
  } catch (err) {
    logFileFailure("list letters", err);
    return { status: "unavailable" };
  }
}

/** What the card is fed. `letters` is null when none were asked for (a lead, or a firm without Document Center). */
export type DocumentsRead = { files: FilesRead; letters: LettersRead | null };

export async function loadDocumentsRead(parent: FileParent, opts: { includeLetters: boolean }): Promise<DocumentsRead> {
  const [files, letters] = await Promise.all([
    listFiles(parent),
    parent.kind === "matter" && opts.includeLetters ? listGeneratedLetters(parent.id) : Promise.resolve(null),
  ]);
  return { files, letters };
}

// ── the merged list ──────────────────────────────────────────────────────────

/** The member directory as the pages already hold it; null = it could not be read. */
export type Directory = readonly { userId: string; name: string }[] | null;

export const UNKNOWN_WHO = "A teammate";

export type DocEntry =
  | { kind: "file"; id: string; name: string; sizeBytes: number; who: string; at: string }
  | { kind: "letter"; id: string; name: string; typeLabel: string; who: string; at: string };

function whoIs(userId: string | null, directory: Directory): string {
  if (!userId || !directory) return UNKNOWN_WHO;
  return directory.find((m) => m.userId === userId)?.name?.trim() || UNKNOWN_WHO;
}

/**
 * Files (by upload time) and letters (by generation time, else creation time) in
 * one list, newest first. Ties keep a stable order: files before letters, each in
 * the order read. "Who" is the uploader or the letter's creator from the member
 * directory; a missing directory or a departed user reads "A teammate", never a guess.
 */
export function buildEntries(read: DocumentsRead, directory: Directory): DocEntry[] {
  const entries: DocEntry[] = [];
  if (read.files.status === "ok") {
    for (const f of read.files.files) {
      entries.push({ kind: "file", id: f.id, name: f.file_name, sizeBytes: f.size_bytes, who: whoIs(f.uploaded_by, directory), at: f.created_at });
    }
  }
  if (read.letters?.status === "ok") {
    for (const l of read.letters.letters) {
      const typeLabel = DOC_TYPE_LABEL[l.doc_type] ?? "Letter";
      entries.push({ kind: "letter", id: l.id, name: l.file_name?.trim() || typeLabel, typeLabel, who: whoIs(l.created_by, directory), at: l.generated_at ?? l.created_at });
    }
  }
  const time = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => time(b.entry.at) - time(a.entry.at) || a.index - b.index)
    .map((x) => x.entry);
}
