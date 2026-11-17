import { FILE_MESSAGES } from "@/lib/files/rules";
import type { DocEntry } from "@/lib/files/read";
import { civilDateIn } from "@/lib/review/build";
import { DECK_DOC_MAX, type RecordDocuments, PANEL_DOC_MAX, documentsCardHref, documentsView, entryHref, entryKindLabel } from "@/lib/review/documents";
import { shortDate } from "@/lib/review/format";
import type { OpenRef } from "@/lib/review/open";
import { REVIEW_DOCS_COMMENT, REVIEW_DOCS_COMMENT_HINT, REVIEW_DOCS_EMPTY, REVIEW_DOCS_LOAD_FAILED, REVIEW_DOCS_OPEN_ALL, REVIEW_DOCS_TITLE, reviewDocsMore } from "@/lib/ui/words";
import { MERGE_HISTORY_PARTIAL } from "@/lib/ui/words";
import { FILES_ERROR_LINE, LETTERS_ERROR_LINE } from "@/components/files/DocumentsCard";
import { ReviewUpload } from "./ReviewUpload";
import "./review.css";

type Member = { userId: string; name: string };

/** Every state of the documents reads, never collapsed: each failed or not-set-up read is its own sentence, and "No documents yet." is for a clean empty only. */
function States({ view }: { view: ReturnType<typeof documentsView> }) {
  return (
    <>
      {view.filesFailed && (
        <p className="lx-note" role="status" style={{ margin: 0 }}>
          {FILES_ERROR_LINE}
        </p>
      )}
      {view.lettersFailed && (
        <p className="lx-note" role="status" style={{ margin: 0 }}>
          {LETTERS_ERROR_LINE}
        </p>
      )}
      {view.partial && (
        <p className="lx-note" role="status" style={{ margin: 0 }}>
          {MERGE_HISTORY_PARTIAL}
        </p>
      )}
      {view.filesNotSetUp && (
        <p className="lx-note" style={{ margin: 0 }}>
          {FILE_MESSAGES.notSetUp}
        </p>
      )}
      {view.empty && (
        <p className="lx-note" style={{ margin: 0 }}>
          {REVIEW_DOCS_EMPTY}
        </p>
      )}
    </>
  );
}

/** File names are the firm's and their clients' words: React text only. A plain anchor, as the Documents & files card uses, so the download route's redirect is followed by the browser. */
function Entry({ entry, today, timeZone }: { entry: DocEntry; today: string; timeZone: string }) {
  const when = shortDate(civilDateIn(entry.at, timeZone), today);
  return (
    <li>
      <span>
        <a href={entryHref(entry)} className="rv-doc-link">
          {entry.name}
        </a>
        <span className="lx-note rv-sub">{[entryKindLabel(entry), when, entry.who].filter(Boolean).join(" · ")}</span>
      </span>
    </li>
  );
}

/** The detail panel's Documents section. The comment entry point is the panel's own "Log what happened" form (an anchor to its id). */
export function ReviewDocuments({
  open,
  documents,
  members,
  today,
  timeZone,
  canWrite,
  canUpload = false,
}: {
  open: OpenRef;
  documents: RecordDocuments;
  members: Member[];
  today: string;
  timeZone: string;
  canWrite: boolean;
  /** Same list as the Documents & files card (FILE_UPLOAD_ROLES). Nothing is drawn for anyone else. */
  canUpload?: boolean;
}) {
  const view = documentsView(documents, members, PANEL_DOC_MAX);
  return (
    <section className="rv-panel-sec" id="rv-sec-docs" aria-labelledby="rv-sec-docs-h">
      <h3 id="rv-sec-docs-h" className="lx-label">
        {REVIEW_DOCS_TITLE}
      </h3>
      <States view={view} />
      {view.shown.length > 0 && (
        <ul className="rv-steps rv-docs">
          {view.shown.map((e) => (
            <Entry key={`${e.kind}:${e.id}`} entry={e} today={today} timeZone={timeZone} />
          ))}
        </ul>
      )}
      {view.more > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          {reviewDocsMore(view.more, view.capped)}
        </p>
      )}
      {canUpload && !view.filesNotSetUp && <ReviewUpload parent={{ kind: open.kind, id: open.id }} />}
      <p style={{ margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* A plain anchor: the href reaches the page exactly as built (the trailing slash and the #documents anchor). */}
        <a href={documentsCardHref(open.kind, open.id)} className="rv-panel-full">
          {REVIEW_DOCS_OPEN_ALL}
        </a>
        {canWrite && (
          <a href="#rv-sec-note" className="rv-panel-full" title={REVIEW_DOCS_COMMENT_HINT}>
            {REVIEW_DOCS_COMMENT}
          </a>
        )}
      </p>
    </section>
  );
}

/** The Cards deck's big card: up to three newest documents and "+N more". `read` is null when the read itself threw. */
export function DeckDocuments({ read, members, today, timeZone }: { read: RecordDocuments | null; members: Member[]; today: string; timeZone: string }) {
  if (!read) {
    return (
      <p className="lx-note" role="status" style={{ margin: 0 }}>
        {REVIEW_DOCS_LOAD_FAILED}
      </p>
    );
  }
  const view = documentsView(read, members, DECK_DOC_MAX);
  return (
    <div className="rv-deck-docs" aria-label={REVIEW_DOCS_TITLE}>
      <States view={view} />
      {view.shown.length > 0 && (
        <ul className="rv-steps rv-docs">
          {view.shown.map((e) => (
            <Entry key={`${e.kind}:${e.id}`} entry={e} today={today} timeZone={timeZone} />
          ))}
        </ul>
      )}
      {view.more > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          {reviewDocsMore(view.more, view.capped)}
        </p>
      )}
    </div>
  );
}
