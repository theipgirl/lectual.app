// MIRRORED FROM theipgirl/lectual:src/app/sign-in/LoginForm.tsx — keep in sync, do not edit locally
// (Styling is this app's own design tokens; the action wiring is the mirror.)
"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  if (state.ok) {
    return (
      <p className="text-sm font-semibold text-[var(--later)]">
        Check your email — your sign-in link is on the way.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="text-sm font-semibold text-[var(--ink)]">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourfirm.com"
        className="w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-base text-[var(--ink)] outline-none focus:border-[var(--accent)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--r-sm)] bg-[var(--accent)] px-4 py-3 text-base font-bold text-[var(--accent-ink)] disabled:opacity-70"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-[var(--overdue)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
