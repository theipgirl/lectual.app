"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import type { PublicIntakeConfig } from "@/lib/intake-forms/config";
import type { AssessmentResultView } from "@/lib/intake-forms/assessment";
import { askedQuestions, type AskedQuestion, type AssessmentAnswers } from "@/lib/intake-forms/assessment-asked";
import { labelsOf } from "@/lib/intake-forms/choice";
import { HONEYPOT_FIELD, SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import { createStepTracker } from "@/lib/intake-forms/step-tracking";
import { completeAssessmentAction, recordIntakeEventAction, recordIntakeStepAction, startIntakeAction } from "../actions";
import { AssessmentNav } from "./AssessmentNav";
import { ChoiceControl } from "./ChoiceControl";
import { IntakeDisclaimer } from "./IntakeShell";

/**
 * The event assessment's public side (lectual 0095): contact first, then the
 * card one question at a time, then the person's own result.
 *
 * The card arrives without points or categories (`publicAssessment`); scoring
 * happens on the server when the answers are sent, from the STORED card. What
 * comes back is only what this person may see: score, band, gaps and next step
 * (or nothing, when the firm hides the score). Hot/warm/cold stays with staff.
 *
 * Nothing here is advice: the questions and the gap lines are the card's own
 * fixed wording, written to describe, never to recommend.
 */

type Contact = { name: string; email: string; phone: string; company: string };
type Answers = AssessmentAnswers;

const RESIZE_MESSAGE = "lectual-intake:resize";

/**
 * One of the firm's own (extra) choice questions. Hook-free, so a test can read its element tree. The control is
 * keyed by the question: two extras in a row with the same option text (Yes / No) must get fresh DOM nodes, or a
 * click still on its way from the last question lands on the new question's option and answers it.
 */
export function AssessmentExtraChoice(props: {
  question: AskedQuestion;
  value: Answers[string] | undefined;
  disabled: boolean;
  onAnswer: (next: string[]) => void;
  onCommit: (next: string[]) => void;
}) {
  const { question, value, disabled, onAnswer, onCommit } = props;
  const multi = question.type === "multi";
  return (
    <ChoiceControl
      key={question.key}
      name={`asm-${question.key}`}
      type={multi ? "multi" : "single"}
      options={question.options.map((o) => o.label)}
      value={labelsOf(value)}
      label={question.question}
      disabled={disabled}
      onChange={onAnswer}
      onCommit={multi ? undefined : onCommit}
    />
  );
}

export function PublicAssessment(props: { slug: string; view: PublicIntakeConfig; stamp: string; embed: boolean }) {
  const { view, slug } = props;
  const card = view.assessment;
  const [contact, setContact] = useState<Contact>({ name: "", email: "", phone: "", company: "" });
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);
  const [done, setDone] = useState<{ closing: string; result: AssessmentResultView | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());
  // Per-step tracking (0096): each question reached, once, with the answers so far. Fire and forget.
  const [stepTracker] = useState(() => createStepTracker((call) => recordIntakeStepAction(slug, call)));

  const track = (kind: "visit" | "start_assessment") => {
    if (sent.current.has(kind)) return;
    sent.current.add(kind);
    recordIntakeEventAction(slug, kind).catch(() => {});
  };

  useEffect(() => {
    track("visit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!props.embed || !root.current || window.parent === window) return;
    const el = root.current;
    const post = () => window.parent.postMessage({ type: RESIZE_MESSAGE, height: Math.ceil(el.getBoundingClientRect().height) }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [props.embed]);

  // The router question picks the track; then the card's questions, then the firm's own.
  const questions = useMemo(() => askedQuestions(card, answers), [answers, card]);
  const current = questions[Math.min(step, questions.length - 1)];
  const currentKey = current?.key;
  const currentIndex = Math.min(step, questions.length - 1);

  useEffect(() => {
    if (token && currentKey !== undefined) {
      stepTracker.track({ token, stepIndex: currentIndex, questionId: currentKey, progress: answers });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentKey, currentIndex]);

  const vars = {
    "--ipub-light-bg": view.colors.lightBg,
    "--ipub-light-acc": view.colors.lightAcc,
    "--ipub-dark-bg": view.colors.darkBg,
    "--ipub-dark-acc": view.colors.darkAcc,
  } as CSSProperties;

  const begin = () => {
    setError(null);
    setBadFields([]);
    track("start_assessment");
    startTransition(async () => {
      try {
        const res = await startIntakeAction(slug, { mode: "form", contact, consent, honeypot, stamp: props.stamp });
        if (res.ok) setToken(res.token);
        else {
          setError(res.error);
          setBadFields(res.fields ?? []);
        }
      } catch {
        setError("We couldn't save your details just now. Please check your connection and try again.");
      }
    });
  };

  const finish = (final: Answers) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await completeAssessmentAction(slug, { token, answers: final });
        if (res.ok) setDone({ closing: res.closing, result: res.result });
        else setError(res.error);
      } catch {
        setError("We couldn't send your answers just now. Please check your connection and try again.");
      }
    });
  };

  const choose = (q: AskedQuestion, value: string) => {
    if (q.type === "multi") {
      const have = labelsOf(answers[q.key]);
      setAnswers({ ...answers, [q.key]: have.includes(value) ? have.filter((v) => v !== value) : [...have, value] });
      return;
    }
    const next = { ...answers, [q.key]: value };
    setAnswers(next);
    // Recompute what's asked with this answer in place, then move on (or finish).
    const list = askedQuestions(card, next);
    const at = list.findIndex((x) => x.key === q.key);
    setError(null);
    if (at >= 0 && at < list.length - 1) setStep(at + 1);
    else finish(next);
  };

  // Multi choice and text questions go on with a button; an optional one can be skipped.
  const advance = (q: AskedQuestion, skip = false) => {
    const v = answers[q.key];
    const blank = Array.isArray(v) ? v.length === 0 : !(v ?? "").trim();
    if (blank && q.required && !skip) {
      setError(q.type === "text" ? "This one's needed to continue." : "Choose at least one.");
      return;
    }
    setError(null);
    const next = { ...answers };
    if (skip || blank) delete next[q.key];
    else if (typeof v === "string") next[q.key] = v.trim();
    setAnswers(next);
    if (step < questions.length - 1) setStep(step + 1);
    else finish(next);
  };

  const header = (
    <header className="ipub-head">
      <div className="ipub-firm">{view.firmName}</div>
      <h1 className="ipub-headline">{card.title}</h1>
      {view.referral && (
        <p className="ipub-small">
          {view.referral.disclosure}
          {view.referral.office ? ` Office: ${view.referral.office}.` : ""}
        </p>
      )}
    </header>
  );

  let body: React.ReactNode;
  if (done) {
    body = (
      <div className="ipub-body" role="status">
        {done.result && (
          <div className="ipub-asm-result">
            <div className="ipub-asm-score">
              <span>{done.result.score}</span>
              <small>/ 100</small>
            </div>
            <div className="ipub-asm-band">{done.result.band}</div>
            {done.result.gaps.length > 0 && (
              <ul className="ipub-asm-gaps">
                {done.result.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            <p className="ipub-asm-next">{done.result.nextStep}</p>
          </div>
        )}
        <div className="ipub-closing">{done.closing}</div>
      </div>
    );
  } else if (token === null) {
    body = (
      <form
        className="ipub-body ipub-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          begin();
        }}
      >
        <p className="ipub-small" style={{ fontSize: 14 }}>
          First, who should we send your results to?
        </p>
        {view.contactFields.map((f) => (
          <label key={f.key} className="ipub-field">
            <span className="ipub-label">
              {f.label}
              {f.required && <span className="ipub-req"> *</span>}
            </span>
            <input
              className="ipub-input"
              type={f.key === "email" ? "email" : f.key === "phone" ? "tel" : "text"}
              autoComplete={f.key === "name" ? "name" : f.key === "email" ? "email" : f.key === "phone" ? "tel" : "organization"}
              maxLength={SUBMIT_LIMITS[f.key]}
              required={f.required}
              aria-invalid={badFields.includes(f.key) || undefined}
              value={contact[f.key]}
              onChange={(e) => setContact((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <div className="ipub-hp" aria-hidden="true">
          <label>
            Leave this empty
            <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
        </div>
        <p className="ipub-small">{view.disclaimer}</p>
        <label className={`ipub-consent${badFields.includes("consent") ? " bad" : ""}`}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{view.consent}</span>
        </label>
        {error && (
          <p className="ipub-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="ipub-submit" disabled={pending}>
          {pending ? "Saving…" : "Start"}
        </button>
      </form>
    );
  } else if (current) {
    const value = answers[current.key];
    const lastStep = step >= questions.length - 1;
    body = (
      <div className="ipub-body">
        <div className="ipub-asm-progress" aria-label={`Question ${step + 1} of ${questions.length}`}>
          <i style={{ width: `${Math.round(((step + 1) / questions.length) * 100)}%` }} />
        </div>
        <div className="ipub-asm-count">
          {step + 1} of {questions.length}
        </div>
        <h2 className="ipub-asm-q">{current.question}</h2>
        {current.subtext && <p className="ipub-small">{current.subtext}</p>}
        {current.type === "text" ? (
          <textarea
            className="ipub-input"
            rows={3}
            maxLength={SUBMIT_LIMITS.answer}
            aria-label={current.question}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setAnswers({ ...answers, [current.key]: e.target.value })}
          />
        ) : current.extra ? (
          <AssessmentExtraChoice
            question={current}
            value={value}
            disabled={pending}
            onAnswer={(next) => setAnswers({ ...answers, [current.key]: current.type === "multi" ? next : (next[0] ?? "") })}
            onCommit={(next) => choose(current, next[0])}
          />
        ) : (
          <div className={`ipub-asm-options${current.grid ? " grid" : ""}`} role={current.type === "multi" ? "group" : "radiogroup"}>
            {current.options.map((o) => {
              const on = Array.isArray(value) ? value.includes(o.value) : value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`ipub-asm-option${on ? " on" : ""}`}
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() => choose(current, o.value)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
        {error && (
          <p className="ipub-error" role="alert">
            {error}
          </p>
        )}
        <AssessmentNav
          step={step}
          lastStep={lastStep}
          current={current}
          pending={pending}
          onBack={() => setStep(step - 1)}
          onSkip={() => advance(current, true)}
          onNext={() => advance(current)}
        />
      </div>
    );
  }

  return (
    <div ref={root} className={`ipub${props.embed ? " embed" : ""}`} data-theme={view.theme} style={vars}>
      <div className="ipub-frame">
        {header}
        {body}
        <div className="ipub-foot">
          <span style={{ flex: 1 }} />
          {view.powered && <span className="ipub-powered">Powered by Lectual</span>}
        </div>
      </div>
      <IntakeDisclaimer firmName={view.firmName} />
    </div>
  );
}
