import type { ReactNode } from "react";
import { LOE_FIELDS } from "@/lib/loe/fields";
import { LOE_KIND_NAMES, type LoeKindName } from "@/lib/loe/kinds";
import { approvedOf, draftOf, versionsOfKind, type LetterPageModel, type LetterVersion } from "@/lib/loe/page-model";
import { validateTemplate } from "@/lib/loe/validate";
import {
  ENGAGEMENT_LETTER_NAME,
  ENGAGEMENT_LETTER_SUB,
  LETTER_APPROVERS_UNREADABLE,
  LETTER_EMPTY_STATE,
  LETTER_FIELDS_HEADING,
  LETTER_FIELDS_NOTE,
  LETTER_KIND_WORDS,
  LETTER_LOAD_FAILED,
  LETTER_NO_APPROVERS,
  LETTER_READ_ONLY_NOTE,
  LETTER_STATUS_WORDS,
  letterApproversLine,
  notReadyYet,
} from "@/lib/ui/words";
import { DraftEditor, StartDraftForm, StartFromVersionForm } from "./LetterForms";
import { LetterPreview } from "./LetterPreview";
import "./loe.css";

const PILL: Record<LetterVersion["status"], string> = { draft: "lx-pill lx-pill-warn", approved: "lx-pill lx-pill-ok", retired: "lx-pill lx-pill-mute" };

function whenText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Head() {
  return (
    <div>
      <div className="lx-label">Settings</div>
      <h1 className="lx-h1">{ENGAGEMENT_LETTER_NAME}</h1>
      <p className="lx-sub">{ENGAGEMENT_LETTER_SUB}</p>
    </div>
  );
}

function Pill({ status }: { status: LetterVersion["status"] }) {
  return <span className={PILL[status]}>{LETTER_STATUS_WORDS[status]}</span>;
}

function MergeFieldList() {
  return (
    <div className="loe-field">
      <h3 className="lx-label" style={{ margin: 0 }}>
        {LETTER_FIELDS_HEADING}
      </h3>
      <ul className="loe-fields" aria-label={LETTER_FIELDS_HEADING}>
        {LOE_FIELDS.map((f) => (
          <li key={f}>
            <code>{`{{${f}}}`}</code>
          </li>
        ))}
      </ul>
      <p className="lx-note" style={{ margin: 0 }}>
        {LETTER_FIELDS_NOTE}
      </p>
    </div>
  );
}

function VersionList({ versions }: { versions: LetterVersion[] }) {
  return (
    <ul className="loe-versions" aria-label="Versions">
      {versions.map((v) => (
        <li key={v.id} className="loe-version">
          <span className="loe-version-name">{`Version ${v.version}`}</span>
          <Pill status={v.status} />
          <span className="loe-version-when">
            {v.status === "approved" && v.approvedAt ? `Approved ${whenText(v.approvedAt)}` : `Updated ${whenText(v.updatedAt)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function KindSection({
  kind,
  versions,
  canEdit,
  canApprove,
}: {
  kind: LoeKindName;
  versions: LetterVersion[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const draft = draftOf(versions);
  const approved = approvedOf(versions);
  const newest = versions[0] ?? null;
  const problems = draft ? validateTemplate({ title: draft.title, body: draft.body }) : [];
  let body: ReactNode;

  if (versions.length === 0) {
    body = canEdit ? (
      <>
        <p className="lx-note" style={{ margin: 0 }}>
          {LETTER_EMPTY_STATE}
        </p>
        <MergeFieldList />
        <StartDraftForm kind={kind} />
      </>
    ) : (
      <p className="lx-note" style={{ margin: 0 }}>
        {LETTER_EMPTY_STATE}
      </p>
    );
  } else {
    body = (
      <>
        <VersionList versions={versions} />
        {draft && canEdit && (
          <>
            {problems.length > 0 && (
              <ul className="loe-problems" role="alert" aria-label="Problems in the draft">
                {problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            )}
            <DraftEditor version={draft} canApprove={canApprove} problems={problems.length > 0} />
            <MergeFieldList />
          </>
        )}
        {draft && !canEdit && (
          <>
            <h3 className="lx-label" style={{ margin: 0 }}>{`Draft, version ${draft.version}`}</h3>
            <pre className="loe-readonly">{draft.body}</pre>
          </>
        )}
        {draft && <LetterPreview body={draft.body} />}
        {!draft && approved && (
          <>
            <h3 className="lx-label" style={{ margin: 0 }}>{`${approved.title}, version ${approved.version}`}</h3>
            <pre className="loe-readonly">{approved.body}</pre>
            <LetterPreview body={approved.body} />
          </>
        )}
        {!draft && !approved && newest && (
          <>
            <h3 className="lx-label" style={{ margin: 0 }}>{`${newest.title}, version ${newest.version}`}</h3>
            <pre className="loe-readonly">{newest.body}</pre>
          </>
        )}
        {!draft && canEdit && newest && <StartFromVersionForm versionId={(approved ?? newest).id} />}
      </>
    );
  }

  return (
    <section className="lx-card loe-kind" aria-labelledby={`loe-${kind}`}>
      <div className="loe-kind-head">
        <h2 id={`loe-${kind}`} className="lx-h2" style={{ fontSize: 25, margin: 0 }}>
          {LETTER_KIND_WORDS[kind]}
        </h2>
        {approved && <Pill status="approved" />}
      </div>
      {body}
    </section>
  );
}

/**
 * The Engagement letter settings screen, drawn from one model (`loadLetterPage`). Three states, never two:
 * a missing table says it isn't switched on (no form), a failed read says it couldn't be loaded (never the
 * empty state), and only a read that worked shows versions or the start-a-draft form.
 */
export function EngagementLetterSettings({ model }: { model: LetterPageModel }) {
  if (model.status === "not-set-up") {
    return (
      <div className="loe-page">
        <Head />
        <div className="lx-card lx-empty-card">
          <p className="lx-note" style={{ margin: 0 }}>
            {notReadyYet("The engagement letter")}
          </p>
        </div>
      </div>
    );
  }
  if (model.status === "unavailable") {
    return (
      <div className="loe-page">
        <Head />
        <div role="alert" className="lx-banner lx-banner-risk">
          {LETTER_LOAD_FAILED}
        </div>
      </div>
    );
  }

  const { canEdit, canApprove, approvers, versions } = model;
  const approversLine =
    approvers.status === "unreadable"
      ? LETTER_APPROVERS_UNREADABLE
      : approvers.names.length === 0
        ? LETTER_NO_APPROVERS
        : letterApproversLine(approvers.names.join(", "));

  return (
    <div className="loe-page">
      <Head />
      {!canEdit && (
        <p className="lx-note" style={{ margin: 0 }}>
          {LETTER_READ_ONLY_NOTE}
        </p>
      )}
      <p className="lx-note" style={{ margin: 0 }} data-testid="approvers-line">
        {approversLine}
      </p>
      {LOE_KIND_NAMES.map((kind) => (
        <KindSection key={kind} kind={kind} versions={versionsOfKind(versions, kind)} canEdit={canEdit} canApprove={canApprove} />
      ))}
    </div>
  );
}
