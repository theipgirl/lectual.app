import { formatRelative } from "@/lib/ui/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { EmptyState, Notice, Pill } from "@/components/ui";
import { BLANK, noneYet, showingAtLeast } from "@/lib/ui/words";
import "./files.css";
import { buildEntries, LIST_CAP, type Directory, type DocEntry, type DocumentsRead } from "@/lib/files/read";
import type { FileParentInput } from "@/lib/files/guard";
import { FILE_MESSAGES, formatFileSize } from "@/lib/files/rules";
import { DeleteFileButton } from "./DeleteFileButton";
import { UploadControl } from "./UploadControl";

/**
 * "Documents & files": the files staff stored on a lead or matter and, for a
 * matter, its generated letters, newest first. Presentational: it takes the
 * result of the reads (`src/lib/files/read.ts`), so it renders without a database.
 *
 * States are never collapsed. "Nothing here yet" appears only when every read
 * made succeeded and found nothing; a failed read says so and is not an empty
 * list; a missing table or bucket ("not set up") is its own quiet sentence, not
 * an error. A failed files read does not hide the letters, and the reverse.
 *
 * Internal only: nothing here shares a file with a client or builds a link for one.
 */

export const DOCS_TITLE = "Documents & files";
export const EMPTY_LINE = noneYet("files");
export const INTERNAL_NOTE = "Files are internal to the firm. Nothing here is shared with a client.";
export const FILES_ERROR_LINE =
  "Files couldn't be loaded. Refresh to try again.";
export const LETTERS_ERROR_LINE =
  "Generated letters couldn't be loaded. Refresh to try again.";

function Entry({ entry, now, tz, canDelete }: { entry: DocEntry; now?: number; tz: string; canDelete: boolean }) {
  const href = entry.kind === "file" ? `/dashboard/files/${entry.id}/download/` : `/dashboard/documents/${entry.id}/download/`;
  const meta = [entry.kind === "file" ? formatFileSize(entry.sizeBytes) : entry.typeLabel, entry.who, formatRelative(entry.at, { tz, now: now === undefined ? undefined : new Date(now) }) ?? BLANK]
    .filter(Boolean)
    .join(" · ");
  return (
    <li data-kind={entry.kind} className="fl-entry">
      <div className="fl-entry-main">
        <div className="fl-entry-name">
          <b>{entry.name}</b>
          {entry.kind === "letter" && <Pill>Generated letter</Pill>}
        </div>
        <span className="lx-note">{meta}</span>
      </div>
      <span className="fl-entry-actions">
        <a href={href} className="lx-btn lx-btn-sec lx-btn-sm">
          Download
        </a>
        {entry.kind === "file" && canDelete && <DeleteFileButton fileId={entry.id} name={entry.name} />}
      </span>
    </li>
  );
}

export function DocumentsCard({
  parent,
  read,
  directory,
  canUpload,
  canDelete,
  now,
  tz = DEFAULT_TIME_ZONE,
}: {
  parent: FileParentInput;
  read: DocumentsRead;
  directory: Directory;
  canUpload: boolean;
  canDelete: boolean;
  /** For tests; left out, times are relative to the moment of rendering. */
  now?: number;
  /** The firm's time zone, for the dates. */
  tz?: string;
}) {
  const { files, letters } = read;
  const entries = buildEntries(read, directory);
  const everyReadWorked = files.status === "ok" && (letters === null || letters.status === "ok");
  const filesCapped = files.status === "ok" && files.capped;
  const lettersCapped = letters?.status === "ok" && letters.capped;

  return (
    <section id="documents" className="lx-card lx-pad fl-card" aria-label={DOCS_TITLE}>
      <h2 className="lx-h3">{DOCS_TITLE}</h2>
      <p className="lx-note">{INTERNAL_NOTE}</p>
      {files.status === "unavailable" && (
        <Notice tone="warn" role="alert">
          {FILES_ERROR_LINE}
        </Notice>
      )}
      {letters?.status === "unavailable" && (
        <Notice tone="warn" role="alert">
          {LETTERS_ERROR_LINE}
        </Notice>
      )}
      {files.status === "not-set-up" && (
        <p className="lx-note">{FILE_MESSAGES.notSetUp}</p>
      )}
      {canUpload && files.status !== "not-set-up" && <UploadControl parent={parent} />}
      {everyReadWorked && entries.length === 0 && (
        <EmptyState variant="line">{EMPTY_LINE}</EmptyState>
      )}
      {entries.length > 0 && (
        <ul className="lx-list">
          {entries.map((entry) => (
            <Entry key={`${entry.kind}:${entry.id}`} entry={entry} now={now} tz={tz} canDelete={canDelete} />
          ))}
        </ul>
      )}
      {filesCapped && (
        <p className="lx-note">{`${showingAtLeast(LIST_CAP)} files.`}</p>
      )}
      {lettersCapped && (
        <p className="lx-note">{`${showingAtLeast(LIST_CAP)} generated letters.`}</p>
      )}
    </section>
  );
}
