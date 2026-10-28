import { relativeTime } from "@/lib/relative-time";
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
export const EMPTY_LINE = "Nothing here yet";
export const INTERNAL_NOTE = "Files are internal to the firm. Nothing here is shared with a client.";
export const FILES_ERROR_LINE =
  "Files couldn't be loaded. Refresh to try again.";
export const LETTERS_ERROR_LINE =
  "Generated letters couldn't be loaded. Refresh to try again.";

function Entry({ entry, now, canDelete }: { entry: DocEntry; now?: number; canDelete: boolean }) {
  const href = entry.kind === "file" ? `/dashboard/files/${entry.id}/download/` : `/dashboard/documents/${entry.id}/download/`;
  const meta = [entry.kind === "file" ? formatFileSize(entry.sizeBytes) : entry.typeLabel, entry.who, relativeTime(entry.at, now)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li data-kind={entry.kind} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ overflowWrap: "anywhere" }}>{entry.name}</b>
          {entry.kind === "letter" && <span className="lx-pill lx-pill-mute">Generated letter</span>}
        </div>
        <span className="lx-note">{meta}</span>
      </div>
      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
}: {
  parent: FileParentInput;
  read: DocumentsRead;
  directory: Directory;
  canUpload: boolean;
  canDelete: boolean;
  /** For tests; left out, times are relative to the moment of rendering. */
  now?: number;
}) {
  const { files, letters } = read;
  const entries = buildEntries(read, directory);
  const everyReadWorked = files.status === "ok" && (letters === null || letters.status === "ok");
  const filesCapped = files.status === "ok" && files.capped;
  const lettersCapped = letters?.status === "ok" && letters.capped;

  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label={DOCS_TITLE}>
      <div>
        <div className="lx-label">Internal to the firm</div>
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          {DOCS_TITLE}
        </h2>
      </div>
      <p className="lx-note" style={{ margin: 0 }}>
        {INTERNAL_NOTE}
      </p>
      {files.status === "unavailable" && (
        <div className="lx-banner lx-banner-warn" role="alert">
          {FILES_ERROR_LINE}
        </div>
      )}
      {letters?.status === "unavailable" && (
        <div className="lx-banner lx-banner-warn" role="alert">
          {LETTERS_ERROR_LINE}
        </div>
      )}
      {files.status === "not-set-up" && (
        <p className="lx-note" style={{ margin: 0 }}>
          {FILE_MESSAGES.notSetUp}
        </p>
      )}
      {canUpload && files.status !== "not-set-up" && <UploadControl parent={parent} />}
      {everyReadWorked && entries.length === 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          {EMPTY_LINE}
        </p>
      )}
      {entries.length > 0 && (
        <ul className="lx-list">
          {entries.map((entry) => (
            <Entry key={`${entry.kind}:${entry.id}`} entry={entry} now={now} canDelete={canDelete} />
          ))}
        </ul>
      )}
      {filesCapped && (
        <p className="lx-note" style={{ margin: 0 }}>
          {`Showing the newest ${LIST_CAP} files.`}
        </p>
      )}
      {lettersCapped && (
        <p className="lx-note" style={{ margin: 0 }}>
          {`Showing the newest ${LIST_CAP} generated letters.`}
        </p>
      )}
    </section>
  );
}
