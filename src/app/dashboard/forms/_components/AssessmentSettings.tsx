"use client";

import { isHideable } from "@/lib/assessment-card/hideable";
import { boothVariant } from "@/lib/assessment-card/variants";
import {
  ASSESSMENT_LIMITS,
  ASSESSMENT_VARIANTS,
  assessmentExtras,
  assessmentQuestions,
  type AssessmentSettings,
  type ExtraQuestion,
} from "@/lib/intake-forms/assessment";
import { isChoice, moveItem, TYPE_LABEL } from "@/lib/intake-forms/choice";
import { newQuestionId } from "@/lib/intake-forms/config";
import { OptionsEditor, QuestionTypeSelect, Switch } from "./ChoiceEditor";

/**
 * The editor's assessment card (lectual 0095): which card, the firm's own
 * wording per question, and whether people see their score. Options, points
 * and order are the card's and aren't editable: the score depends on them.
 *
 * Sprint 10 adds the firm's OWN questions after the card (never scored) and a
 * hide switch on the few card questions nothing reads. Every other card
 * question has no switch and says why: hiding it would change the score, the
 * hot/warm/cold call, the Lawmatics tag or which questions are asked.
 */

const VARIANT_HELP: Record<(typeof ASSESSMENT_VARIANTS)[number], string> = {
  business: "Entity, trademark, IP ownership, contracts, revenue and timing. Eight questions.",
  ip: "Name and logo, clearance, conflicts, copyright and ownership. For brand and content events.",
};

export function AssessmentSettingsCard({
  settings,
  onChange,
  disabled = false,
}: {
  settings: AssessmentSettings;
  onChange: (next: AssessmentSettings) => void;
  disabled?: boolean;
}) {
  const card = boothVariant(settings.variant);
  const hidden = new Set(settings.hidden ?? []);
  const extras = assessmentExtras(settings);
  const setExtras = (next: ExtraQuestion[]) => onChange({ ...settings, extras: next });
  const editExtra = (id: string, patch: Partial<ExtraQuestion>) => setExtras(extras.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const setHidden = (id: string, on: boolean) => {
    const next = on ? [...hidden, id] : [...hidden].filter((x) => x !== id);
    onChange({ ...settings, hidden: next });
  };
  const setWording = (id: number, key: "question" | "subtext", value: string) => {
    const cur = settings.wording[String(id)] ?? { question: "", subtext: "" };
    const next = { ...cur, [key]: value };
    const wording = { ...settings.wording };
    if (!next.question && !next.subtext) delete wording[String(id)];
    else wording[String(id)] = next;
    onChange({ ...settings, wording });
  };

  return (
    <section id="ifm-sec-assessment" className="ifm-card">
      <h2 className="ifm-title">Assessment</h2>
      <div className="ifm-modes">
        {ASSESSMENT_VARIANTS.map((v) => {
          const on = settings.variant === v;
          return (
            <button
              key={v}
              type="button"
              className={`ifm-mode${on ? " on" : ""}`}
              aria-pressed={on}
              disabled={disabled}
              // A different card clears the rewording and the hidden list: both name the old card's questions.
              onClick={() => onChange({ ...settings, variant: v, wording: v === settings.variant ? settings.wording : {}, hidden: v === settings.variant ? settings.hidden : [] })}
            >
              <span className="ifm-mode-head">
                <span className="ifm-mode-title">{boothVariant(v).title}</span>
              </span>
              <span className="ifm-help">{VARIANT_HELP[v]}</span>
            </button>
          );
        })}
      </div>
      <label className="ifm-check">
        <input type="checkbox" checked={settings.showScore} onChange={(e) => onChange({ ...settings, showScore: e.target.checked })} />
        <span>Show people their score and biggest gaps when they finish</span>
      </label>
      <p className="ifm-help" style={{ margin: 0 }}>
        Hot, warm or cold is only ever shown to your firm: on the lead, in Intake numbers and as a Lawmatics tag.
      </p>

      <div className="ifm-field">
        <span className="ifm-field-label">Question wording</span>
        <span className="ifm-help">
          Leave a box empty to use the standard wording. Answers, points and order stay fixed, because the score depends on them.
        </span>
        <ol className="ifm-asm-list">
          {card.questions.map((q) => {
            const w = settings.wording[String(q.id)];
            const canHide = isHideable(settings.variant, q.id);
            const isHidden = hidden.has(String(q.id));
            return (
              <li key={q.id} className={`ifm-asm-q${isHidden ? " hidden" : ""}`}>
                <input
                  className="ifm-input"
                  value={w?.question ?? ""}
                  placeholder={q.question}
                  maxLength={ASSESSMENT_LIMITS.question}
                  aria-label={`Question ${q.id} wording`}
                  onChange={(e) => setWording(q.id, "question", e.target.value)}
                />
                <input
                  className="ifm-input ifm-asm-sub"
                  value={w?.subtext ?? ""}
                  placeholder={q.subtext || "Optional note under the question"}
                  maxLength={ASSESSMENT_LIMITS.subtext}
                  aria-label={`Question ${q.id} note`}
                  onChange={(e) => setWording(q.id, "subtext", e.target.value)}
                />
                <span className="ifm-help">{q.options.map((o) => o.label).join(" · ")}</span>
                {canHide ? (
                  <span className="ifm-asm-hide">
                    <Switch on={isHidden} disabled={disabled} label={`Hide question ${q.id}`} onClick={() => setHidden(String(q.id), !isHidden)} />
                    <span className="ifm-help">
                      {isHidden ? "Hidden. People aren't asked this, and it never affected the score." : "Hide this question. Nothing reads it, so the score doesn't change."}
                    </span>
                  </span>
                ) : (
                  <span className="ifm-help ifm-asm-stays">
                    {q.category ? "Scored, so it stays." : "Feeds the hot, warm or cold call or which questions are asked, so it stays."}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="ifm-field" id="ifm-sec-extras">
        <span className="ifm-field-label">Your own questions</span>
        <span className="ifm-help">
          Asked after the card, in this order. They are not scored: they never change the score, the band, hot, warm or cold, or the Lawmatics tag.
          Your team sees the answers on the lead and in Results.
        </span>
        {extras.length === 0 ? (
          <div className="ifm-empty">No questions of your own yet. People answer only the card.</div>
        ) : (
          <ol className="ifm-extras">
            {extras.map((e, i) => (
              <li key={e.id} className={`ifm-extra${isChoice(e) ? " has-options" : ""}`}>
                <input
                  className="ifm-input ifm-q-text"
                  value={e.text}
                  maxLength={ASSESSMENT_LIMITS.question}
                  disabled={disabled}
                  placeholder="e.g. Which event did you hear about us at?"
                  aria-label={`Your question ${i + 1}`}
                  onChange={(ev) => editExtra(e.id, { text: ev.target.value })}
                />
                <QuestionTypeSelect
                  type={e.type}
                  label={`Your question ${i + 1}`}
                  disabled={disabled}
                  onChange={(fields) => setExtras(extras.map((x) => (x.id === e.id ? { id: x.id, text: x.text, required: x.required, type: fields.type ?? "text", ...(fields.options ? { options: fields.options } : {}) } : x)))}
                />
                <span className="ifm-q-req">
                  <span className="ifm-help">Required</span>
                  <Switch on={e.required} disabled={disabled} label={`Your question ${i + 1} required`} onClick={() => editExtra(e.id, { required: !e.required })} />
                </span>
                <span className="ifm-extra-moves">
                  <button type="button" className="ifm-link" disabled={disabled || i === 0} aria-label={`Move your question ${i + 1} up`} onClick={() => setExtras(moveItem(extras, i, -1))}>
                    Up
                  </button>
                  <button type="button" className="ifm-link" disabled={disabled || i === extras.length - 1} aria-label={`Move your question ${i + 1} down`} onClick={() => setExtras(moveItem(extras, i, 1))}>
                    Down
                  </button>
                  <button type="button" className="ifm-link" disabled={disabled} aria-label={`Remove your question ${i + 1}`} onClick={() => setExtras(extras.filter((x) => x.id !== e.id))}>
                    Remove
                  </button>
                </span>
                {isChoice(e) && (
                  <div className="ifm-q-options">
                    <OptionsEditor options={e.options ?? []} label={`Your question ${i + 1}`} disabled={disabled} onChange={(options) => editExtra(e.id, { options })} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          className="ifm-add"
          disabled={disabled || extras.length >= ASSESSMENT_LIMITS.extras}
          onClick={() => setExtras([...extras, { id: newQuestionId(), text: "", required: false, type: "text" }])}
        >
          Add a question
        </button>
        <span className="ifm-help">{`${extras.length} of ${ASSESSMENT_LIMITS.extras} questions of your own.`}</span>
      </div>
    </section>
  );
}

/** The right-hand preview for an assessment: the card as people will see it. */
export function AssessmentPreview({ settings }: { settings: AssessmentSettings }) {
  const questions = assessmentQuestions(settings, "business");
  const extras = assessmentExtras(settings).filter((e) => e.text.trim());
  return (
    <div className="ifm-card ifm-asm-preview" aria-label="Assessment preview">
      <div className="ifm-field-label">Preview</div>
      <h3 className="ifm-title" style={{ margin: 0 }}>
        {boothVariant(settings.variant).title}
      </h3>
      <p className="ifm-help" style={{ margin: 0 }}>
        Name, email, phone and consent first. Then one question at a time:
      </p>
      <ol className="ifm-asm-plist">
        {questions.map((q) => (
          <li key={q.id}>
            <strong>{q.question}</strong>
            {q.subtext && <span className="ifm-help"> {q.subtext}</span>}
          </li>
        ))}
        {extras.map((e) => (
          <li key={e.id}>
            <strong>{e.text}</strong>
            <span className="ifm-help">{` ${TYPE_LABEL[e.type]}${e.required ? ", required" : ""}. Your question, not scored.`}</span>
          </li>
        ))}
      </ol>
      <p className="ifm-help" style={{ margin: 0 }}>
        {settings.showScore ? "At the end they see their score out of 100, a band and their biggest gaps." : "At the end they see your closing message."}
      </p>
    </div>
  );
}
