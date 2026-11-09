"use client";

import { useActionState, type ReactNode } from "react";
import type { ReviewActionState } from "@/app/dashboard/review/actions";
import "./review.css";

/** One small form that runs one server action and says what happened in a fixed sentence. Rendered only for a role that can write. */
export function ActForm({
  action,
  children,
  submit,
  className = "rv-form",
  buttonClass = "lx-btn lx-btn-sec lx-btn-sm",
}: {
  action: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
  children?: ReactNode;
  submit: string;
  className?: string;
  buttonClass?: string;
}) {
  const [state, formAction, pending] = useActionState<ReviewActionState, FormData>(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "…" : submit}
      </button>
      {state.error && (
        <p role="alert" className="rv-err">
          {state.error}
        </p>
      )}
      {!state.error && state.saved && (
        <p role="status" className="rv-saved">
          Saved
        </p>
      )}
    </form>
  );
}
