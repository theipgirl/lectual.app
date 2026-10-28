"use client";

import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { FIRST_PROBLEM_ID } from "@/lib/proposal-editor/issues";

/** A validation problem as the editor shows it: plain words, no path. */
export type ShownIssue = { level: "error" | "warning"; message: string; where: string; /** The one "Go to first problem" lands on. */ anchor?: boolean };

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form that posts to a server action WITHOUT React's automatic form reset.
 *
 * `<form action={fn}>` resets every uncontrolled field to its default value
 * once the action returns, success or not. For a refusal ("Base price: enter a
 * dollar amount") that would wipe what the person just typed. Here the submit
 * handler builds the `FormData` itself (including the clicked button's name and
 * value) and calls the action inside a transition, so a refusal leaves the
 * fields as they were and a success leaves them showing what was saved.
 *
 * Nothing in here is a boundary: the server action re-checks the module and the
 * caller's role on its own.
 */
export function ActionForm({
  action,
  children,
  confirm,
  className,
  id,
}: {
  action: Action;
  children: (s: { state: ActionState; pending: boolean }) => ReactNode;
  /** A question to ask before submitting (withdraw, remove). */
  confirm?: string;
  className?: string;
  /** Lets fields placed elsewhere on the page (More options) belong to this form through their `form` attribute. */
  id?: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, {});

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null);
    startTransition(() => dispatch(data));
  }

  return (
    <form id={id} onSubmit={onSubmit} className={className}>
      {children({ state, pending })}
    </form>
  );
}

/** The outcome of the last submit: refusal, notice or "Saved.", then any listed problems. */
export function Outcome({ state, pending, savedText = "Saved." }: { state: ActionState; pending?: boolean; savedText?: string }) {
  if (pending) return null;
  return (
    <>
      {state.error && (
        <p role="alert" className="pe-msg pe-msg-err">
          {state.error}
        </p>
      )}
      {state.issues && state.issues.length > 0 && (
        <ul className="pe-issues pe-msg">
          {state.issues.map((i, n) => (
            <li key={n} data-level={i.level}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      {!state.error && state.saved && (
        <p role="status" className="pe-msg pe-msg-ok">
          {state.notice ?? savedText}
        </p>
      )}
    </>
  );
}

/** Inline problems for one section (from `validateContent`), errors first. */
export function IssueList({ issues }: { issues: ShownIssue[] }) {
  if (issues.length === 0) return null;
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return (
    <ul className="pe-issues" aria-label="Problems in this section">
      {sorted.map((i, n) => (
        <li key={n} data-level={i.level} id={i.anchor ? FIRST_PROBLEM_ID : undefined}>
          <span className="pe-issue-tag">{i.level === "error" ? "Fix" : "Check"}</span>
          {i.where && <span className="pe-issue-where">{i.where}: </span>}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/** Save button + outcome, hidden entirely when the section is read-only. */
export function SaveRow({
  editable,
  state,
  pending,
  label = "Save",
  children,
}: {
  editable: boolean;
  state: ActionState;
  pending: boolean;
  label?: string;
  children?: ReactNode;
}) {
  if (!editable) return null;
  return (
    <div className="pe-save">
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {children}
      <Outcome state={state} pending={pending} />
    </div>
  );
}
