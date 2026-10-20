"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import type { PublicIntakeConfig } from "@/lib/intake-forms/config";
import type { PublicAssessmentQuestion } from "@/lib/intake-forms/assessment";
import type { AssessmentResultView } from "@/lib/intake-forms/assessment";
import { HONEYPOT_FIELD, SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import { completeAssessmentAction, recordIntakeEventAction, startIntakeAction } from "../actions";
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
type Answers = Record<string, string | string[]>;

const RESIZE_MESSAGE = "lectual-intake:resize";

function asked(q: PublicAssessmentQuestion, answers: Answers): boolean {
  if (!q.showWhen) return true;
  const a = answers[String(q.showWhen.qId)];
  if (Array.isArray(a)) return a.some((v) => q.showWhen!.anyOf.includes(v));
  return typeof a === "string" && q.showWhen.anyOf.includes(a);
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

  // The router question picks the track; "brand" uses the personal-brand wording.
  const questions = useMemo(() => {
    const t = answers[String(card.trackQuestionId)];
    const list = (Array.isArray(t) ? t[0] : t) === "brand" ? card.brand : card.business;
    return list.filter((q) => asked(q, answers));
  }, [answers, card]);
  const current = questions[Math.min(step, questions.length - 1)];

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

  const choose = (q: PublicAssessmentQuestion, value: string) => {
    if (q.multiSelect) {
      const have = Array.isArray(answers[String(q.id)]) ? (answers[String(q.id)] as string[]) : [];
      setAnswers({ ...answers, [String(q.id)]: have.includes(value) ? have.filter((v) => v !== value) : [...have, value] });
      return;
    }
    const next = { ...answers, [String(q.id)]: value };
    setAnswers(next);
    // Recompute what's asked with this answer in place, then move on (or finish).
    const t = next[String(card.trackQuestionId)];
    const list = ((Array.isArray(t) ? t[0] : t) === "brand" ? card.brand : card.business).filter((x) => asked(x, next));
    const at = list.findIndex((x) => x.id === q.id);
    if (at >= 0 && at < list.length - 1) setStep(at + 1);
    else finish(next);
  };

  const advanceMulti = (q: PublicAssessmentQuestion) => {
    const v = answers[String(q.id)];
    if (!Array.isArray(v) || v.length === 0) {
      setError("Choose at least one.");
      return;
    }
    setError(null);
    if (step < questions.length - 1) setStep(step + 1);
    else finish(answers);
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
    const value = answers[String(current.id)];
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
        <div className={`ipub-asm-options${current.grid ? " grid" : ""}`} role={current.multiSelect ? "group" : "radiogroup"}>
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
        {error && (
          <p className="ipub-error" role="alert">
            {error}
          </p>
        )}
        <div className="ipub-asm-nav">
          {step > 0 && (
            <button type="button" className="ipub-link" onClick={() => setStep(step - 1)} disabled={pending}>
              Back
            </button>
          )}
          <span style={{ flex: 1 }} />
          {current.multiSelect && (
            <button type="button" className="ipub-submit" onClick={() => advanceMulti(current)} disabled={pending}>
              {step < questions.length - 1 ? "Next" : pending ? "Sending…" : "See my results"}
            </button>
          )}
          {pending && !current.multiSelect && <span className="ipub-small">Scoring…</span>}
        </div>
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
