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
import type { LetterLogo } from "@/lib/loe/letter-logo";
import { LetterPreview } from "./LetterPreview";
import { EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { toneFor, type PillTone } from "@/lib/ui/tones";
import { formatDay } from "@/lib/ui/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import "./loe.css";

const STATUS_TONE: Record<LetterVersion["status"], PillTone> = { draft: toneFor("needsPerson"), approved: toneFor("done"), retired: toneFor("neutral") };

function whenText(iso: string | null, tz: string): string {
  return formatDay(iso, { tz }) ?? "";
}

function Head() {
  return <PageHeader title={ENGAGEMENT_LETTER_NAME} sub={ENGAGEMENT_LETTER_SUB} />;
}

function StatusPill({ status }: { status: LetterVersion["status"] }) {
  return <Pill tone={STATUS_TONE[status]}>{LETTER_STATUS_WORDS[status]}</Pill>;
}

function MergeFieldList() {
  return (
    <div className="loe-field">
      <h3 className="lx-label">
        {LETTER_FIELDS_HEADING}
      </h3>
      <ul className="loe-fields" aria-label={LETTER_FIELDS_HEADING}>
        {LOE_FIELDS.map((f) => (
          <li key={f}>
            <code>{`{{${f}}}`}</code>
          </li>
        ))}
      </ul>
      <p className="lx-note">
        {LETTER_FIELDS_NOTE}
      </p>
    </div>
  );
}

function VersionList({ versions, tz }: { versions: LetterVersion[]; tz: string }) {
  return (
    <ul className="loe-versions" aria-label="Versions">
      {versions.map((v) => (
        <li key={v.id} className="loe-version">
          <span className="loe-version-name">{`Version ${v.version}`}</span>
          <StatusPill status={v.status} />
          <span className="loe-version-when">
            {v.status === "approved" && v.approvedAt ? `Approved ${whenText(v.approvedAt, tz)}` : `Updated ${whenText(v.updatedAt, tz)}`}
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
  logo,
  tz,
}: {
  tz: string;
  kind: LoeKindName;
  versions: LetterVersion[];
  canEdit: boolean;
  canApprove: boolean;
  logo?: LetterLogo | null;
}) {
  const draft = draftOf(versions);
  const approved = approvedOf(versions);
  const newest = versions[0] ?? null;
  const problems = draft ? validateTemplate({ title: draft.title, body: draft.body }) : [];
  let body: ReactNode;

  if (versions.length === 0) {
    body = canEdit ? (
      <>
        <p className="lx-note">
          {LETTER_EMPTY_STATE}
        </p>
        <MergeFieldList />
        <StartDraftForm kind={kind} />
      </>
    ) : (
      <p className="lx-note">
        {LETTER_EMPTY_STATE}
      </p>
    );
  } else {
    body = (
      <>
        <VersionList versions={versions} tz={tz} />
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
            <h3 className="lx-label">{`Draft, version ${draft.version}`}</h3>
            <pre className="loe-readonly">{draft.body}</pre>
          </>
        )}
        {draft && <LetterPreview body={draft.body} logo={logo} />}
        {!draft && approved && (
          <>
            <h3 className="lx-label">{`${approved.title}, version ${approved.version}`}</h3>
            <pre className="loe-readonly">{approved.body}</pre>
            <LetterPreview body={approved.body} logo={logo} />
          </>
        )}
        {!draft && !approved && newest && (
          <>
            <h3 className="lx-label">{`${newest.title}, version ${newest.version}`}</h3>
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
        <h2 id={`loe-${kind}`} className="lx-h2">
          {LETTER_KIND_WORDS[kind]}
        </h2>
        {approved && <StatusPill status="approved" />}
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
export function EngagementLetterSettings({ model, logo, tz = DEFAULT_TIME_ZONE }: { model: LetterPageModel; logo?: LetterLogo | null; /** The firm's time zone, for the dates. */ tz?: string }) {
  if (model.status === "not-set-up") {
    return (
      <div className="loe-page">
        <Head />
        <EmptyState>{notReadyYet("The engagement letter")}</EmptyState>
      </div>
    );
  }
  if (model.status === "unavailable") {
    return (
      <div className="loe-page">
        <Head />
        <Notice tone="risk" role="alert">
          {LETTER_LOAD_FAILED}
        </Notice>
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
        <p className="lx-note">
          {LETTER_READ_ONLY_NOTE}
        </p>
      )}
      <p className="lx-note" data-testid="approvers-line">
        {approversLine}
      </p>
      {LOE_KIND_NAMES.map((kind) => (
        <KindSection key={kind} kind={kind} versions={versionsOfKind(versions, kind)} canEdit={canEdit} canApprove={canApprove} logo={logo} tz={tz} />
      ))}
    </div>
  );
}
