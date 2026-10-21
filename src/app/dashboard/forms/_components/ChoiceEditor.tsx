"use client";

import { CHOICE_LIMITS, moveItem, QUESTION_TYPES, TYPE_LABEL, withType, type ChoiceFields, type QuestionType } from "@/lib/intake-forms/choice";

/**
 * The editor's controls for a choice question, used by the intake's question
 * rows and by an assessment's own questions: a type select, and for a choice an
 * option list the firm can add to, edit, reorder and remove, with the counts.
 * Limits come from choice.ts, the same file the save check and the public form
 * read, so the editor can't offer what the server will refuse.
 */

export function QuestionTypeSelect({
  type,
  label,
  disabled,
  onChange,
}: {
  type: QuestionType;
  label: string;
  disabled?: boolean;
  onChange: (next: ChoiceFields) => void;
}) {
  return (
    <select
      className="ifm-input ifm-q-type"
      value={type}
      disabled={disabled}
      aria-label={`${label} type`}
      onChange={(e) => onChange(withType({ type }, e.target.value as QuestionType))}
    >
      {QUESTION_TYPES.map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/** The option list of one choice question. `onChange` gets the whole new list. */
export function OptionsEditor({
  options,
  label,
  disabled,
  onChange,
}: {
  options: readonly string[];
  label: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const set = (i: number, v: string) => onChange(options.map((o, j) => (j === i ? v : o)));
  const tooFew = options.length < CHOICE_LIMITS.minOptions;
  return (
    <div className="ifm-opts" aria-label={`${label} options`}>
      <ol className="ifm-opts-list">
        {options.map((o, i) => (
          <li key={i} className="ifm-opt">
            <input
              className="ifm-input"
              value={o}
              maxLength={CHOICE_LIMITS.option}
              disabled={disabled}
              placeholder={`Option ${i + 1}`}
              aria-label={`${label} option ${i + 1}`}
              onChange={(e) => set(i, e.target.value)}
            />
            <button type="button" className="ifm-icon-btn" disabled={disabled || i === 0} aria-label={`Move ${label} option ${i + 1} up`} onClick={() => onChange(moveItem(options, i, -1))}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="ifm-icon-btn"
              disabled={disabled || i === options.length - 1}
              aria-label={`Move ${label} option ${i + 1} down`}
              onClick={() => onChange(moveItem(options, i, 1))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <button type="button" className="ifm-icon-btn" disabled={disabled} aria-label={`Remove ${label} option ${i + 1}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      <div className="ifm-opts-foot">
        <button type="button" className="ifm-link" disabled={disabled || options.length >= CHOICE_LIMITS.maxOptions} onClick={() => onChange([...options, ""])}>
          Add option
        </button>
        <span className={`ifm-help${tooFew ? " ifm-opts-warn" : ""}`}>
          {`${options.length} of ${CHOICE_LIMITS.maxOptions} options · at least ${CHOICE_LIMITS.minOptions} · up to ${CHOICE_LIMITS.option} characters each`}
        </span>
      </div>
    </div>
  );
}

/** The editor's on/off switch (same markup as the setup page's own). */
export function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`ifm-switch${on ? " on" : ""}`} onClick={onClick}>
      <i />
    </button>
  );
}
