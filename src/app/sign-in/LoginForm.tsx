"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  if (state.ok) {
    return (
      <p role="status" style={{ margin: 0, color: "var(--ok)", fontWeight: 500 }}>
        Check your email — your sign-in link is on the way.
      </p>
    );
  }

  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="lx-label" style={{ fontSize: 11.5 }}>
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourfirm.com"
        className="lx-input"
      />
      <button type="submit" className="lx-btn lx-btn-pri" disabled={pending} style={{ height: 42 }}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state.error && (
        <p role="alert" style={{ margin: 0, color: "var(--wine)", fontSize: 14 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
