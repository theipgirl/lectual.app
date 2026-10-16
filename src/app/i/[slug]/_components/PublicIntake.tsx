"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import type { PublicIntakeConfig } from "@/lib/intake-forms/config";
import type { IntakeMode } from "@/lib/intake-forms/config";
import { HONEYPOT_FIELD, SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import { isEmailAddress } from "@/lib/members/email";
import { recordIntakeEventAction, submitIntakeAction } from "../actions";
import { IntakeDisclaimer } from "./IntakeShell";

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
 * a browser. Nothing is sent anywhere until Submit.
 */

type Pkg = { name: string; price: string; includes: string };
type Contact = { name: string; email: string; phone: string; company: string };
type Step = { key: string; prompt: string; required: boolean; kind: "contact" | "question"; long: boolean };

const RESIZE_MESSAGE = "lectual-intake:resize";

export function PublicIntake(props: { slug: string; view: PublicIntakeConfig; packages: Pkg[]; stamp: string; embed: boolean }) {
  const { view, packages, slug } = props;
  const [mode, setMode] = useState<IntakeMode>(view.mode);
  const [contact, setContact] = useState<Contact>({ name: "", email: "", phone: "", company: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);
  const [closing, setClosing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const sent = useRef(new Set<string>());

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
      { key: "name", prompt: "First, what's your full name?", required: true, kind: "contact", long: false },
      { key: "email", prompt: "What email should we reply to?", required: true, kind: "contact", long: false },
      { key: "phone", prompt: "A phone number? This one's optional.", required: false, kind: "contact", long: false },
      { key: "company", prompt: "And your company, if you have one? Also optional.", required: false, kind: "contact", long: false },
      ...view.questions.map((q) => ({ key: q.id, prompt: q.text, required: q.required, kind: "question" as const, long: true })),
    ],
    [view.questions],
  );

  const valueOf = (s: Step): string => (s.kind === "contact" ? contact[s.key as keyof Contact] : (answers[s.key] ?? ""));
  const setValue = (key: string, kind: Step["kind"], v: string) => {
    track(mode === "conversation" ? "start_conversation" : "start_form");
    if (kind === "contact") setContact((c) => ({ ...c, [key]: v }));
    else setAnswers((a) => ({ ...a, [key]: v }));
  };

  const vars = {
    "--ipub-light-bg": view.colors.lightBg,
    "--ipub-light-acc": view.colors.lightAcc,
    "--ipub-dark-bg": view.colors.darkBg,
    "--ipub-dark-acc": view.colors.darkAcc,
  } as CSSProperties;

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

  const consentBlock = (
    <>
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
      <button type="button" className="ipub-submit" onClick={submit} disabled={pending}>
        {pending ? "Sending…" : "Submit"}
      </button>
    </>
  );

  const foot = (switchLabel: string, to: IntakeMode) => (
    <div className="ipub-foot">
      {!closing && (
        <button type="button" className="ipub-link" onClick={() => setMode(to)}>
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
            setValue={setValue}
            pkgList={pkgList}
            consentBlock={consentBlock}
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
              submit();
            }}
            noValidate
          >
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
                  onChange={(e) => setValue(f.key, "contact", e.target.value)}
                />
              </label>
            ))}
            {view.questions.map((q) => (
              <label key={q.id} className="ipub-field">
                <span className="ipub-label">
                  {q.text}
                  {q.required && <span className="ipub-req"> *</span>}
                </span>
                <textarea
                  className="ipub-input"
                  rows={3}
                  maxLength={SUBMIT_LIMITS.answer}
                  required={q.required}
                  aria-invalid={badFields.includes(q.id) || undefined}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setValue(q.id, "question", e.target.value)}
                />
              </label>
            ))}
            {pkgList && (
              <div className="ipub-field">
                <span className="ipub-label">Flat-fee packages</span>
                {pkgList}
              </div>
            )}
            {honeypotField}
            {consentBlock}
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
  setValue: (key: string, kind: Step["kind"], v: string) => void;
  pkgList: React.ReactNode;
  consentBlock: React.ReactNode;
  closing: string | null;
  error: string | null;
}) {
  const { steps, valueOf } = props;
  // Resume where the answers stop (e.g. after "Chat instead").
  const firstOpen = () => {
    const i = steps.findIndex((s) => s.required && !valueOf(s).trim());
    return i < 0 ? steps.length : i;
  };
  const [step, setStep] = useState(firstOpen);
  const [draft, setDraft] = useState(() => (step < steps.length ? valueOf(steps[step]) : ""));
  const [hint, setHint] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [step, props.closing, props.error]);

  const current = step < steps.length ? steps[step] : null;

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
    const next = step + 1;
    setStep(next);
    setDraft(next < steps.length ? valueOf(steps[next]) : "");
    inputRef.current?.focus();
  };

  const thread: { who: "bot" | "you"; text: string }[] = [{ who: "bot", text: props.view.opening }];
  steps.slice(0, step).forEach((s) => {
    thread.push({ who: "bot", text: s.prompt });
    const v = valueOf(s).trim();
    thread.push({ who: "you", text: v || "Skipped" });
  });
  if (current) thread.push({ who: "bot", text: current.prompt });

  return (
    <>
      <div className="ipub-thread" aria-live="polite">
        {thread.map((m, i) => (
          <div key={i} className={`ipub-bubble ${m.who}`}>
            {m.text}
          </div>
        ))}
        {!current && !props.closing && (
          <>
            {props.pkgList && (
              <>
                <div className="ipub-bubble bot">Here are our flat-fee packages, so you know what to expect.</div>
                {props.pkgList}
              </>
            )}
            <div className="ipub-bubble bot">That&rsquo;s everything. Please confirm below and send it to us.</div>
            <div className="ipub-final">{props.consentBlock}</div>
          </>
        )}
        {props.closing && (
          <div className="ipub-bubble bot" role="status">
            {props.closing}
          </div>
        )}
        <div ref={endRef} />
      </div>
      {current && !props.closing && (
        <div className="ipub-composer-wrap">
          {hint && <p className="ipub-error">{hint}</p>}
          <div className="ipub-composer">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={current.kind === "question" ? SUBMIT_LIMITS.answer : SUBMIT_LIMITS[current.key as "name" | "email" | "phone" | "company"]}
              onChange={(e) => {
                setDraft(e.target.value);
                props.setValue(current.key, current.kind, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  advance(draft);
                }
              }}
              placeholder="Type your answer…"
              aria-label={current.prompt}
            />
            {!current.required && (
              <button type="button" className="ipub-skip" onClick={() => advance("")}>
                Skip
              </button>
            )}
            <button type="button" className="ipub-send" onClick={() => advance(draft)} aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
