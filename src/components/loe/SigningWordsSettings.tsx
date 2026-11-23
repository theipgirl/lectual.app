import { WORDS_FIELDS, WORDS_LABELS, wordsIssues } from "@/lib/loe/signing-words";
import type { WordsVersion } from "@/lib/loe/signing-words-store";
import { issueSentence } from "@/lib/loe/signing-words-actions";
import type { WordsStatus as EmailStatus } from "@/lib/loe/email-signing/settings-status";
import {
  CANT_SHOW,
  LETTER_APPROVERS_UNREADABLE,
  LETTER_NO_APPROVERS,
  LETTER_STATUS_WORDS,
  SIGNING_WORDS_EMPTY,
  SIGNING_WORDS_FIELDS_NOTE,
  SIGNING_WORDS_LOAD_FAILED,
  SIGNING_WORDS_NAME,
  SIGNING_WORDS_READ_ONLY,
  SIGNING_WORDS_STATUS_NO_WORDS,
  SIGNING_WORDS_STATUS_ON,
  SIGNING_WORDS_SUB,
  letterApproversLine,
  notReadyYet,
} from "@/lib/ui/words";
import { EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { toneFor } from "@/lib/ui/tones";
import { StartWordsForm, StartWordsFromVersionForm, WordsDraftEditor } from "./SigningWordsForms";
import "./loe.css";

export type SigningWordsModel =
  | { status: "not-set-up" }
  | { status: "unavailable" }
  | {
      status: "ok";
      canEdit: boolean;
      canApprove: boolean;
      approvers: { status: "ok"; names: string[] } | { status: "unreadable" };
      versions: WordsVersion[];
    };

/** The status line: says plainly whether the emailed link is on for the firm, and why not. */
export function statusLine(status: EmailStatus): string {
  if (status === "on") return SIGNING_WORDS_STATUS_ON;
  if (status === "no_words") return SIGNING_WORDS_STATUS_NO_WORDS;
  if (status === "unreadable") return CANT_SHOW;
  return notReadyYet("Emailed signing links");
}

function ReadOnlyWords({ version }: { version: WordsVersion }) {
  return (
    <dl className="loe-words">
      {WORDS_FIELDS.map((f) => (
        <div key={f}>
          <dt className="lx-label">{WORDS_LABELS[f]}</dt>
          <dd>
            <pre className="loe-readonly">{version[f]}</pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SigningWordsSettings({ model, emailStatus }: { model: SigningWordsModel; emailStatus: EmailStatus }) {
  const head = <PageHeader title={SIGNING_WORDS_NAME} sub={SIGNING_WORDS_SUB} />;
  const status = (
    <p className="lx-note" data-testid="signing-status">
      {statusLine(emailStatus)}
    </p>
  );
  if (model.status === "not-set-up") {
    return (
      <div className="loe-page">
        {head}
        <EmptyState>{notReadyYet("Emailed signing links")}</EmptyState>
      </div>
    );
  }
  if (model.status === "unavailable") {
    return (
      <div className="loe-page">
        {head}
        {status}
        <Notice tone="risk" role="alert">
          {SIGNING_WORDS_LOAD_FAILED}
        </Notice>
      </div>
    );
  }
  const { canEdit, canApprove, approvers, versions } = model;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const approved = versions.find((v) => v.status === "approved") ?? null;
  const problems = draft ? wordsIssues(draft) : [];
  const approversLine =
    approvers.status === "unreadable" ? LETTER_APPROVERS_UNREADABLE : approvers.names.length === 0 ? LETTER_NO_APPROVERS : letterApproversLine(approvers.names.join(", "));

  return (
    <div className="loe-page">
      {head}
      {status}
      {!canEdit && <p className="lx-note">{SIGNING_WORDS_READ_ONLY}</p>}
      <p className="lx-note" data-testid="approvers-line">
        {approversLine}
      </p>
      <section className="lx-card loe-kind" aria-labelledby="sw-head">
        <div className="loe-kind-head">
          <h2 id="sw-head" className="lx-h2">
            {SIGNING_WORDS_NAME}
          </h2>
          {approved && <Pill tone={toneFor("done")}>{LETTER_STATUS_WORDS.approved}</Pill>}
        </div>
        <p className="lx-note">{SIGNING_WORDS_FIELDS_NOTE}</p>
        {versions.length > 0 && (
          <ul className="loe-versions" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.id} className="loe-version">
                <span className="loe-version-name">{`Version ${v.version}`}</span>
                <Pill tone={toneFor(v.status === "approved" ? "done" : v.status === "draft" ? "needsPerson" : "neutral")}>{LETTER_STATUS_WORDS[v.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
        {versions.length === 0 && <p className="lx-note">{SIGNING_WORDS_EMPTY}</p>}
        {versions.length === 0 && canEdit && <StartWordsForm />}
        {draft && canEdit && (
          <>
            {problems.length > 0 && (
              <ul className="loe-problems" role="alert" aria-label="Problems in the draft">
                {problems.map((p, i) => (
                  <li key={i}>{issueSentence(p)}</li>
                ))}
              </ul>
            )}
            <WordsDraftEditor version={draft} canApprove={canApprove} problems={problems.length > 0} />
          </>
        )}
        {draft && !canEdit && <ReadOnlyWords version={draft} />}
        {!draft && approved && <ReadOnlyWords version={approved} />}
        {!draft && canEdit && versions.length > 0 && <StartWordsFromVersionForm versionId={(approved ?? versions[0]).id} />}
      </section>
    </div>
  );
}
