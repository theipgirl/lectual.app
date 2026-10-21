"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { answerText, labelsOf, questionType, type AnswerValue } from "@/lib/intake-forms/choice";
import { createStepTracker } from "@/lib/intake-forms/step-tracking";
import type { PublicIntakeConfig } from "@/lib/intake-forms/config";
import type { IntakeMode } from "@/lib/intake-forms/config";
import { HONEYPOT_FIELD, SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import { isEmailAddress } from "@/lib/members/email";
import { recordIntakeEventAction, recordIntakeStepAction, startIntakeAction, submitIntakeAction } from "../actions";
import { IntakeDisclaimer } from "./IntakeShell";
import { buildThread, ConversationInput, ThreadBubbles, type ChatStep } from "./ConversationParts";
import { QuestionFields } from "./QuestionFields";

/**
 * The prospect's side of a firm's intake: Form (everything on one page) or
 * Conversation (scripted, one question at a time, in the chat look of the
 * editor's live preview). Both write the same state, so "Switch to form" and
 * "Chat instead" keep every answer.
 *
 * The conversation is SCRIPTED. There is no model on this side: the prospect
 * is only ever asked the firm's own questions and shown the firm's own words,
 * so nothing here can read as advice. Screening happens later, on the server,
 * for the firm's eyes only.
 *
 * `view` is `publicConfig()` — the only part of the firm's setup that reaches
 * a browser.
 *
 * CONTACT FIRST (0093): name, email and consent come before any question, and
 * Continue files them, so someone who stops halfway is still someone the firm
 * can follow up. The server hands back a token that ties Submit to that same
 * record. Until Continue, nothing is sent.
 */

type Pkg = { name: string; price: string; includes: string };
type Contact = { name: string; email: string; phone: string; company: string };
type Step = ChatStep;

const RESIZE_MESSAGE = "lectual-intake:resize";

export function PublicIntake(props: { slug: string; view: PublicIntakeConfig; packages: Pkg[]; stamp: string; embed: boolean }) {
  const { view, packages, slug } = props;
  const [mode, setMode] = useState<IntakeMode>(view.mode);
  const [contact, setContact] = useState<Contact>({ name: "", email: "", phone: "", company: "" });
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);
  const [closing, setClosing] = useState<string | null>(null);
  // Contact step done (the person is filed); `token` ties Submit to that row.
  const [started, setStarted] = useState(false);
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());
  // Per-step tracking (0096): which question was reached, plus the answers so far. Fire and forget.
  const [stepTracker] = useState(() => createStepTracker((call) => recordIntakeStepAction(slug, call)));
  const trackStep = (questionId: string, index: number) =>
    stepTracker.track({ token, stepIndex: index, questionId, progress: answers });

  const track = (kind: "visit" | "start_conversation" | "start_form") => {
    if (sent.current.has(kind)) return;
    sent.current.add(kind);
    // Fire and forget: the funnel must never slow or break the intake.
    recordIntakeEventAction(slug, kind).catch(() => {});
  };

  useEffect(() => {
    track("visit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In an embed, tell the host page how tall we are (public/embed.js sizes the iframe).
  useEffect(() => {
    if (!props.embed || !root.current || window.parent === window) return;
    const el = root.current;
    const post = () => window.parent.postMessage({ type: RESIZE_MESSAGE, height: Math.ceil(el.getBoundingClientRect().height) }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [props.embed]);

  const steps: Step[] = useMemo(
    () => [
      { key: "name", prompt: "First, what's your full name?", required: true, kind: "contact", type: "text", options: [] },
      { key: "email", prompt: "What email should we reply to?", required: true, kind: "contact", type: "text", options: [] },
      { key: "phone", prompt: "A phone number? This one's optional.", required: false, kind: "contact", type: "text", options: [] },
      { key: "company", prompt: "And your company, if you have one? Also optional.", required: false, kind: "contact", type: "text", options: [] },
      ...view.questions.map((q) => ({
        key: q.id,
        prompt: q.text,
        required: q.required,
        kind: "question" as const,
        type: questionType(q),
        options: q.options ?? [],
      })),
    ],
    [view.questions],
  );

  // An answer as one line of text; a multi choice's labels are joined for the thread.
  const valueOf = (s: Step): string => (s.kind === "contact" ? contact[s.key as keyof Contact] : answerText(answers[s.key]));
  const listOf = (s: Step): string[] => (s.kind === "contact" ? [] : labelsOf(answers[s.key]));
  const setValue = (key: string, kind: Step["kind"], v: AnswerValue) => {
    track(mode === "conversation" ? "start_conversation" : "start_form");
    if (kind === "contact") setContact((c) => ({ ...c, [key]: answerText(v) }));
    else setAnswers((a) => ({ ...a, [key]: v }));
  };

  const vars = {
    "--ipub-light-bg": view.colors.lightBg,
    "--ipub-light-acc": view.colors.lightAcc,
    "--ipub-dark-bg": view.colors.darkBg,
    "--ipub-dark-acc": view.colors.darkAcc,
  } as CSSProperties;

  const begin = () => {
    setError(null);
    setBadFields([]);
    startTransition(async () => {
      try {
        const res = await startIntakeAction(slug, { mode, contact, consent, honeypot, stamp: props.stamp });
        if (res.ok) {
          setToken(res.token);
          setStarted(true);
        } else {
          setError(res.error);
          setBadFields(res.fields ?? []);
        }
      } catch {
        setError("We couldn't save your details just now. Please check your connection and try again.");
      }
    });
  };

  const submit = () => {
    setError(null);
    setBadFields([]);
    startTransition(async () => {
      try {
        const res = await submitIntakeAction(slug, {
          mode,
          contact,
          answers,
          consent,
          honeypot,
          stamp: props.stamp,
          token,
        });
        if (res.ok) {
          setClosing(res.closing);
          setContact({ name: "", email: "", phone: "", company: "" });
          setAnswers({});
        } else {
          setError(res.error);
          setBadFields(res.fields ?? []);
        }
      } catch {
        setError("We couldn't send your answers just now. Please check your connection and try again.");
      }
    });
  };

  const intro = (
    <header className="ipub-head">
      <div className="ipub-firm">{view.firmName}</div>
      <h1 className="ipub-headline">{view.headline}</h1>
      {view.referral && (
        <p className="ipub-small">
          {view.referral.disclosure}
          {view.referral.office ? ` Office: ${view.referral.office}.` : ""}
        </p>
      )}
    </header>
  );

  const pkgList = packages.length > 0 && (
    <div className="ipub-pkgs">
      {packages.map((p, i) => (
        <div key={i} className="ipub-pkg">
          <div className="ipub-pkg-head">
            <span className="ipub-pkg-name">{p.name}</span>
            <span className="ipub-pkg-price">{p.price}</span>
          </div>
          {p.includes && <div className="ipub-small">{p.includes}</div>}
        </div>
      ))}
    </div>
  );

  const honeypotField = (
    <div className="ipub-hp" aria-hidden="true">
      <label>
        Leave this empty
        <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </label>
    </div>
  );

  const errorLine = error && (
    <p className="ipub-error" role="alert">
      {error}
    </p>
  );

  // The contact step's end: consent, then Continue (files the person).
  const beginBlock = (
    <>
      <p className="ipub-small">{view.disclaimer}</p>
      <label className={`ipub-consent${badFields.includes("consent") ? " bad" : ""}`}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{view.consent}</span>
      </label>
      {errorLine}
      <button type="button" className="ipub-submit" onClick={begin} disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </button>
    </>
  );

  // The end of the questions: send the answers.
  const finalBlock = (
    <>
      {errorLine}
      <button type="button" className="ipub-submit" onClick={submit} disabled={pending}>
        {pending ? "Sending…" : "Submit"}
      </button>
    </>
  );

  const foot = (switchLabel: string, to: IntakeMode) => (
    <div className="ipub-foot">
      {!closing && (
        <button type="button" className="ipub-link" onClick={() => setMode(to)} disabled={pending}>
          {switchLabel}
        </button>
      )}
      <span style={{ flex: 1 }} />
      {view.powered && <span className="ipub-powered">Powered by Lectual</span>}
    </div>
  );

  return (
    <div ref={root} className={`ipub${props.embed ? " embed" : ""}`} data-theme={view.theme} style={vars}>
      <div className="ipub-frame">
        {intro}
        {mode === "conversation" ? (
          <Conversation
            view={view}
            steps={steps}
            valueOf={valueOf}
            listOf={listOf}
            setValue={setValue}
            onStep={trackStep}
            pkgList={pkgList}
            beginBlock={beginBlock}
            finalBlock={finalBlock}
            started={started}
            closing={closing}
            error={error}
          />
        ) : closing ? (
          <div className="ipub-body">
            <div className="ipub-closing" role="status">
              {closing}
            </div>
          </div>
        ) : (
          <form
            className="ipub-body ipub-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (started) submit();
              else begin();
            }}
            noValidate
          >
            {!started && view.contactFields.map((f) => (
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
                  onChange={(e) => setValue(f.key, "contact", e.target.value)}
                />
              </label>
            ))}
            {started && (
              <p className="ipub-small ipub-step-note">
                Thanks{contact.name.trim() ? `, ${contact.name.trim().split(/\s+/)[0]}` : ""}. We have your details. Now a few questions.
              </p>
            )}
            {started && (
              <QuestionFields
                questions={view.questions}
                answers={answers}
                badFields={badFields}
                idPrefix="form"
                onTouch={(id, i) => trackStep(id, i)}
                onChange={(id, v) => setValue(id, "question", v)}
              />
            )}
            {started && pkgList && (
              <div className="ipub-field">
                <span className="ipub-label">Flat-fee packages</span>
                {pkgList}
              </div>
            )}
            {honeypotField}
            {started ? finalBlock : beginBlock}
          </form>
        )}
        {mode === "conversation" && honeypotField}
        {foot(mode === "conversation" ? "Switch to form" : "Chat instead", mode === "conversation" ? "form" : "conversation")}
      </div>
      <IntakeDisclaimer firmName={view.firmName} />
    </div>
  );
}

function Conversation(props: {
  view: PublicIntakeConfig;
  steps: Step[];
  valueOf: (s: Step) => string;
  listOf: (s: Step) => string[];
  setValue: (key: string, kind: Step["kind"], v: AnswerValue) => void;
  /** A question was shown: its position among the questions (contact steps don't count) and id. */
  onStep: (questionId: string, index: number) => void;
  pkgList: React.ReactNode;
  beginBlock: React.ReactNode;
  finalBlock: React.ReactNode;
  started: boolean;
  closing: string | null;
  error: string | null;
}) {
  const { steps, valueOf } = props;
  const contactCount = steps.filter((s) => s.kind === "contact").length;
  // Resume where the answers stop (e.g. after "Chat instead").
  const firstOpen = () => {
    const i = steps.findIndex((s) => s.required && !valueOf(s).trim());
    return i < 0 ? steps.length : i;
  };
  const [step, setStep] = useState(firstOpen);
  const [draft, setDraft] = useState(() => (step < steps.length ? valueOf(steps[step]) : ""));
  const [picked, setPicked] = useState<string[]>(() => (step < steps.length ? props.listOf(steps[step]) : []));
  const [hint, setHint] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [step, props.closing, props.error]);

  const current = step < steps.length ? steps[step] : null;
  // Contact first: the questions wait until the person's details are filed.
  const gated = !props.started && step >= contactCount;

  // Reaching a question records a step (once per question per page load; the tracker dedupes).
  useEffect(() => {
    if (current && current.kind === "question" && !gated && props.started) props.onStep(current.key, step - contactCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gated, props.started]);

  const goTo = (next: number) => {
    setStep(next);
    setDraft(next < steps.length ? valueOf(steps[next]) : "");
    setPicked(next < steps.length ? props.listOf(steps[next]) : []);
  };

  const advance = (value: string) => {
    if (!current) return;
    const v = value.trim();
    if (current.required && !v) {
      setHint("This one's needed to continue.");
      return;
    }
    if (current.key === "email" && current.kind === "contact" && !isEmailAddress(v)) {
      setHint("That email address doesn't look right.");
      return;
    }
    props.setValue(current.key, current.kind, v);
    setHint(null);
    goTo(step + 1);
    inputRef.current?.focus();
  };

  // A choice question: a single choice goes on with the tap; a multi choice goes on with Done.
  const advanceChoice = (labels: string[]) => {
    if (!current) return;
    if (current.required && labels.length === 0) {
      setHint("Choose at least one to continue.");
      return;
    }
    props.setValue(current.key, current.kind, current.type === "multi" ? labels : (labels[0] ?? ""));
    setHint(null);
    goTo(step + 1);
  };

  const onPick = (next: string[]) => {
    if (!current) return;
    if (current.type === "multi") {
      setPicked(next);
      props.setValue(current.key, current.kind, next);
      return;
    }
    advanceChoice(next);
  };

  const thread = buildThread({
    opening: props.view.opening,
    steps,
    answered: step,
    textOf: valueOf,
    current: current && !gated ? current : null,
  });

  return (
    <>
      <div className="ipub-thread" aria-live="polite">
        <ThreadBubbles thread={thread} />
        {gated && !props.closing && (
          <>
            <div className="ipub-bubble bot">Thanks. Before the questions, please confirm we may contact you.</div>
            <div className="ipub-final">{props.beginBlock}</div>
          </>
        )}
        {!current && !gated && !props.closing && (
          <>
            {props.pkgList && (
              <>
                <div className="ipub-bubble bot">Here are our flat-fee packages, so you know what to expect.</div>
                {props.pkgList}
              </>
            )}
            <div className="ipub-bubble bot">That&rsquo;s everything. Send it to us below.</div>
            <div className="ipub-final">{props.finalBlock}</div>
          </>
        )}
        {props.closing && (
          <div className="ipub-bubble bot" role="status">
            {props.closing}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {current && !gated && !props.closing && (
        <ConversationInput
          step={current}
          draft={draft}
          maxLength={current.kind === "question" ? SUBMIT_LIMITS.answer : SUBMIT_LIMITS[current.key as "name" | "email" | "phone" | "company"]}
          hint={hint}
          picked={picked}
          inputRef={inputRef}
          onDraft={(v) => {
            setDraft(v);
            props.setValue(current.key, current.kind, v);
          }}
          onSend={() => advance(draft)}
          onSkip={() => (current.type === "text" ? advance("") : advanceChoice([]))}
          onPick={onPick}
          onDone={() => advanceChoice(picked)}
        />
      )}
    </>
  );
}
