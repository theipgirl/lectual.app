import { buildEntries, type Directory, type DocEntry, type DocumentsRead } from "@/lib/files/read";
import { extensionOf } from "@/lib/files/rules";
import { reviewDocsCount } from "@/lib/ui/words";

/**
 * Pure rules for the documents shown on the weekly review (the detail panel and the Cards deck). The reads
 * are `loadDocumentsRead` (src/lib/files/read.ts), reused as they are; this turns their result into what
 * is drawn. States are never collapsed: a read that failed or is not set up is its own flag, and `empty`
 * is true ONLY when every read that was made succeeded and found nothing.
 */

export const PANEL_DOC_MAX = 8;
export const DECK_DOC_MAX = 3;

/** The reads plus whether the merged leads' history (lectual 0107) could not be listed. */
export type RecordDocuments = DocumentsRead & { mergedPartial?: boolean };

export type DocumentsView = {
  /** Newest first, at most `max`. */
  shown: DocEntry[];
  /** Entries beyond `shown`. */
  more: number;
  filesNotSetUp: boolean;
  filesFailed: boolean;
  lettersFailed: boolean;
  /** A reader hit its cap (100 files / 100 letters): the count of the rest is a floor. */
  capped: boolean;
  /** Merged leads' files could not be listed: what is shown may be incomplete. */
  partial: boolean;
  /** Every read worked and nothing was found. */
  empty: boolean;
};

export function documentsView(read: RecordDocuments, directory: Directory, max: number): DocumentsView {
  const entries = buildEntries(read, directory);
  const everyReadWorked = read.files.status === "ok" && (read.letters === null || read.letters.status === "ok");
  return {
    shown: entries.slice(0, max),
    more: Math.max(0, entries.length - max),
    filesNotSetUp: read.files.status === "not-set-up",
    filesFailed: read.files.status === "unavailable",
    lettersFailed: read.letters?.status === "unavailable",
    capped: (read.files.status === "ok" && read.files.capped) || (read.letters?.status === "ok" && read.letters.capped),
    partial: !!read.mergedPartial,
    empty: everyReadWorked && !read.mergedPartial && entries.length === 0,
  };
}

/** "File · PDF" or "Letter · Opinion letter". */
export function entryKindLabel(entry: DocEntry): string {
  if (entry.kind === "letter") return `Letter · ${entry.typeLabel}`;
  const ext = extensionOf(entry.name);
  return ext ? `File · ${ext.toUpperCase()}` : "File";
}

/** The existing download routes: stored files and generated letters. */
export function entryHref(entry: DocEntry): string {
  return entry.kind === "file" ? `/dashboard/files/${entry.id}/download/` : `/dashboard/documents/${entry.id}/download/`;
}

/** The tag text for a card or row: only a known count above zero. Unknown (null / undefined) and 0 draw nothing. */
export function documentsTag(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  return reviewDocsCount(count);
}

/** The review's id for the full page's Documents & files card. */
export function documentsCardHref(kind: "matter" | "lead", id: string): string {
  return `/dashboard/${kind === "matter" ? "matters" : "leads"}/${id}/#documents`;
}
