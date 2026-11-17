import { getScopedClient } from "@/lib/db/scoped-client";
import { DOC_TYPE_LABEL } from "@/lib/documents/list";
import { isMissingTableError, logFileFailure } from "./errors";
import type { FileParentKind } from "./rules";
import { TEAMMATE } from "@/lib/ui/words";

/**
 * The reads behind the "Documents & files" card. Every read goes through the
 * caller's scoped client (RLS on org_id), never the service role, and none of
 * them throws. A failed read is NEVER an empty list: files and letters each
 * report their own outcome, so one failing cannot hide the other.
 */

/** `mergedIds` (a lead only): the leads merged into this one (lectual 0107), whose files stay on them and are listed here too. */
export type FileParent = { kind: FileParentKind; id: string; mergedIds?: readonly string[] };

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
    const base = supabase.from("crm_file").select("id, file_name, mime, size_bytes, uploaded_by, created_at");
    const column = parent.kind === "lead" ? "lead_id" : "matter_id";
    const merged = parent.kind === "lead" && parent.mergedIds?.length ? parent.mergedIds : null;
    const { data, error } = await (merged ? base.in(column, [parent.id, ...merged]) : base.eq(column, parent.id))
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

export const UNKNOWN_WHO = TEAMMATE;

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

// ── counts for the weekly review ─────────────────────────────────────────────

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

const COUNT_PAGE = 1000;
const COUNT_MAX_PAGES = 10;

/** Stored files per lead or matter for ONE chunk of ids (the caller chunks). A missing table is zero files (there is no table to hold any); any other failure throws, so the caller names the gap instead of showing 0. */
export async function countFilesByParent(db: ScopedClient, kind: FileParentKind, ids: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const column = kind === "lead" ? "lead_id" : "matter_id";
  for (let page = 0; page < COUNT_MAX_PAGES; page++) {
    const { data, error } = await db.from("crm_file").select(`id, ${column}`).in(column, [...ids]).order("id").range(page * COUNT_PAGE, page * COUNT_PAGE + COUNT_PAGE - 1);
    if (error) {
      if (isMissingTableError(error)) return counts;
      logFileFailure("count files", error);
      throw new Error("count failed");
    }
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) {
      const parent = r[column];
      if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    if (rows.length < COUNT_PAGE) return counts;
  }
  throw new Error("count exceeded its page budget");
}

/** Generated letters (status "generated", the ones that have a download) per matter for ONE chunk of ids. Throws on any failure. */
export async function countLettersByMatter(db: ScopedClient, ids: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  for (let page = 0; page < COUNT_MAX_PAGES; page++) {
    const { data, error } = await db.from("crm_document_draft").select("id, matter_id").eq("status", "generated").in("matter_id", [...ids]).order("id").range(page * COUNT_PAGE, page * COUNT_PAGE + COUNT_PAGE - 1);
    if (error) {
      logFileFailure("count letters", error);
      throw new Error("count failed");
    }
    const rows = (data ?? []) as { matter_id: string | null }[];
    for (const r of rows) if (r.matter_id) counts.set(r.matter_id, (counts.get(r.matter_id) ?? 0) + 1);
    if (rows.length < COUNT_PAGE) return counts;
  }
  throw new Error("count exceeded its page budget");
}
