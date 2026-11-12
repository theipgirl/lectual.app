"use client";

import { ActionForm, Outcome } from "@/components/proposal-editor/ActionForm";
import {
  approveLetterAction,
  saveDraftAction,
  startDraftAction,
  startFromVersionAction,
} from "@/app/dashboard/settings/proposals/engagement-letter/actions";
import type { LoeKindName } from "@/lib/loe/kinds";
import type { LetterVersion } from "@/lib/loe/page-model";
import {
  LETTER_APPROVAL_NOTE,
  LETTER_APPROVE,
  LETTER_FIX_BEFORE_APPROVING,
  LETTER_SAVE_DRAFT,
  LETTER_START_DRAFT,
  LETTER_START_FROM_VERSION,
} from "@/lib/ui/words";

/** The words for one title field and one text field; both forms use them. */
function LetterFields({ idPrefix, title, body }: { idPrefix: string; title: string; body: string }) {
  return (
    <>
      <div className="loe-field">
        <label className="lx-label" htmlFor={`${idPrefix}-title`}>
          Title
        </label>
        <input id={`${idPrefix}-title`} name="title" className="lx-input" defaultValue={title} maxLength={200} required />
      </div>
      <div className="loe-field">
        <label className="lx-label" htmlFor={`${idPrefix}-body`}>
          Letter text
        </label>
        <textarea id={`${idPrefix}-body`} name="body" className="lx-input loe-body" defaultValue={body} maxLength={60000} required spellCheck />
      </div>
    </>
  );
}

/** Nothing yet for this kind: type the first draft. */
export function StartDraftForm({ kind }: { kind: LoeKindName }) {
  return (
    <ActionForm action={startDraftAction} className="loe-form">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="kind" value={kind} />
          <LetterFields idPrefix={`start-${kind}`} title="Engagement letter" body="" />
          <div className="loe-actions">
            <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
              {pending ? "Saving…" : LETTER_START_DRAFT}
            </button>
            <Outcome state={state} pending={pending} savedText="Draft started." />
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** A new draft that starts as a copy of an approved or retired version. The server re-reads the text. */
export function StartFromVersionForm({ versionId }: { versionId: string }) {
  return (
    <ActionForm action={startFromVersionAction} className="loe-form">
      {({ state, pending }) => (
        <div className="loe-actions">
          <input type="hidden" name="versionId" value={versionId} />
          <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
            {pending ? "Starting…" : LETTER_START_FROM_VERSION}
          </button>
          <Outcome state={state} pending={pending} savedText="Draft started." />
        </div>
      )}
    </ActionForm>
  );
}

/** Edit the open draft, and (for a named approver) approve it. */
export function DraftEditor({ version, canApprove, problems }: { version: LetterVersion; canApprove: boolean; problems: boolean }) {
  return (
    <div className="loe-form">
      <ActionForm action={saveDraftAction} className="loe-form">
        {({ state, pending }) => (
          <>
            <input type="hidden" name="id" value={version.id} />
            <LetterFields idPrefix={`draft-${version.id}`} title={version.title} body={version.body} />
            <div className="loe-actions">
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
                {pending ? "Saving…" : LETTER_SAVE_DRAFT}
              </button>
              <Outcome state={state} pending={pending} savedText="Draft saved." />
            </div>
          </>
        )}
      </ActionForm>
      {canApprove && (
        <ActionForm action={approveLetterAction} className="loe-form">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="id" value={version.id} />
              <div className="loe-actions">
                <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || problems} aria-describedby={problems ? `fix-${version.id}` : undefined}>
                  {pending ? "Approving…" : LETTER_APPROVE}
                </button>
                {problems && (
                  <span id={`fix-${version.id}`} className="lx-note">
                    {LETTER_FIX_BEFORE_APPROVING}
                  </span>
                )}
              </div>
              <p className="lx-note loe-approve-note">{LETTER_APPROVAL_NOTE}</p>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
