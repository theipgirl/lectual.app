"use client";

import { useState, useTransition } from "react";
import type { AnswerValue } from "@/lib/intake-forms/choice";
import { QuestionFields, type FieldQuestion } from "../../../i/[slug]/_components/QuestionFields";
import { submitIntakeRequestAction } from "../actions";

/**
 * The firm's intake questions, sent to an existing client from a matter.
 * Form mode only, questions only: the firm already knows who the client is.
 */
export function RequestForm(props: { token: string; questions: FieldQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
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
      <QuestionFields
        questions={props.questions}
        answers={answers}
        badFields={bad}
        idPrefix="request"
        onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
      />
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
