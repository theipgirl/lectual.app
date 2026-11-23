"use client";

import { ActionForm, Outcome } from "@/components/proposal-editor/ActionForm";
import { approveWordsAction, saveWordsDraftAction, startWordsDraftAction } from "@/app/dashboard/settings/proposals/signing-words/actions";
import { WORDS_FIELDS, WORDS_LABELS, WORDS_LIMITS, type SigningWords } from "@/lib/loe/signing-words";
import type { WordsVersion } from "@/lib/loe/signing-words-store";
import {
  SAVING,
  SIGNING_WORDS_APPROVE,
  SIGNING_WORDS_APPROVE_NOTE,
  SIGNING_WORDS_FIX_BEFORE_APPROVING,
  SIGNING_WORDS_SAVE,
  SIGNING_WORDS_START,
  SIGNING_WORDS_START_FROM,
} from "@/lib/ui/words";

const ONE_LINE = new Set(["consent_line", "link_subject", "copy_subject"]);

/** The eight fields, each labelled by NAME. No placeholder or sample wording: the firm writes every word. */
function WordsFields({ idPrefix, words }: { idPrefix: string; words: Partial<SigningWords> }) {
  return (
    <>
      {WORDS_FIELDS.map((f) => (
        <div className="loe-field" key={f}>
          <label className="lx-label" htmlFor={`${idPrefix}-${f}`}>
            {WORDS_LABELS[f]}
          </label>
          {ONE_LINE.has(f) ? (
            <input id={`${idPrefix}-${f}`} name={f} className="lx-input" defaultValue={words[f] ?? ""} maxLength={WORDS_LIMITS[f]} required />
          ) : (
            <textarea id={`${idPrefix}-${f}`} name={f} className="lx-input loe-body" defaultValue={words[f] ?? ""} maxLength={WORDS_LIMITS[f]} required spellCheck />
          )}
        </div>
      ))}
    </>
  );
}

export function StartWordsForm() {
  return (
    <ActionForm action={startWordsDraftAction} className="loe-form">
      {({ state, pending }) => (
        <>
          <WordsFields idPrefix="start-words" words={{}} />
          <div className="loe-actions">
            <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
              {pending ? SAVING : SIGNING_WORDS_START}
            </button>
            <Outcome state={state} pending={pending} savedText="Draft started." />
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function StartWordsFromVersionForm({ versionId }: { versionId: string }) {
  return (
    <ActionForm action={startWordsDraftAction} className="loe-form">
      {({ state, pending }) => (
        <div className="loe-actions">
          <input type="hidden" name="versionId" value={versionId} />
          <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
            {pending ? SAVING : SIGNING_WORDS_START_FROM}
          </button>
          <Outcome state={state} pending={pending} savedText="Draft started." />
        </div>
      )}
    </ActionForm>
  );
}

export function WordsDraftEditor({ version, canApprove, problems }: { version: WordsVersion; canApprove: boolean; problems: boolean }) {
  return (
    <div className="loe-form">
      <ActionForm action={saveWordsDraftAction} className="loe-form">
        {({ state, pending }) => (
          <>
            <input type="hidden" name="id" value={version.id} />
            <WordsFields idPrefix={`words-${version.id}`} words={version} />
            <div className="loe-actions">
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
                {pending ? SAVING : SIGNING_WORDS_SAVE}
              </button>
              <Outcome state={state} pending={pending} savedText="Draft saved." />
            </div>
          </>
        )}
      </ActionForm>
      {canApprove && (
        <ActionForm action={approveWordsAction} className="loe-form">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="id" value={version.id} />
              <div className="loe-actions">
                <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || problems} aria-describedby={problems ? `wfix-${version.id}` : undefined}>
                  {pending ? SAVING : SIGNING_WORDS_APPROVE}
                </button>
                {problems && (
                  <span id={`wfix-${version.id}`} className="lx-note">
                    {SIGNING_WORDS_FIX_BEFORE_APPROVING}
                  </span>
                )}
              </div>
              <p className="lx-note loe-approve-note">{SIGNING_WORDS_APPROVE_NOTE}</p>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
