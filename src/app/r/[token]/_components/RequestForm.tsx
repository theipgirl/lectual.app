"use client";

import { useState, useTransition } from "react";
import { SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import { submitIntakeRequestAction } from "../actions";

/**
 * The firm's intake questions, sent to an existing client from a matter.
 * Form mode only, questions only: the firm already knows who the client is.
 */
export function RequestForm(props: { token: string; questions: { id: string; text: string; required: boolean }[] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="ipub-body">
        <div className="ipub-closing" role="status">
          Thank you. Your answers are with the firm. You can close this page.
        </div>
      </div>
    );
  }

  return (
    <form
      className="ipub-body ipub-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setBad([]);
        startTransition(async () => {
          try {
            const res = await submitIntakeRequestAction(props.token, answers);
            if (res.ok) setDone(true);
            else {
              setError(res.error);
              setBad(res.fields ?? []);
            }
          } catch {
            setError("We couldn't send your answers just now. Please check your connection and try again.");
          }
        });
      }}
    >
      {props.questions.map((q) => (
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
            aria-invalid={bad.includes(q.id) || undefined}
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          />
        </label>
      ))}
      {error && (
        <p className="ipub-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="ipub-submit" disabled={pending}>
        {pending ? "Sending…" : "Send answers"}
      </button>
    </form>
  );
}
