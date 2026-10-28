"use client";

import { useActionState, useEffect, useState } from "react";
import { SIGN_IN_SPAM_HINT } from "@/lib/ui/words";
import { sendMagicLink, type LoginState } from "./actions";

const RESEND_WAIT_SECONDS = 30;

type SentState = LoginState & { sends?: number };

/** Remounted (by key) after each send, so the 30-second wait starts again. */
function ResendButton({ pending }: { pending: boolean }) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_WAIT_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <button type="submit" className="lx-btn" disabled={pending || secondsLeft > 0}>
      {pending ? "Sending…" : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend the link"}
    </button>
  );
}

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SentState, FormData>(async (prev, formData) => {
    const result = await sendMagicLink(prev, formData);
    // A refused resend keeps the confirmation on screen and shows its sentence there.
    if (!result.ok && prev.ok) return { ...prev, error: result.error };
    return { ...result, sends: result.ok ? (prev.sends ?? 0) + 1 : prev.sends };
  }, {});
  // "Use a different address" hides the confirmation without touching the action state.
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const confirmed = state.ok && dismissedFor !== state.sends;

  if (confirmed) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p role="status" style={{ margin: 0, color: "var(--ok)", fontWeight: 500, fontSize: 15 }}>
          We sent a link to {state.email}.
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>{SIGN_IN_SPAM_HINT}</p>
        {(state.sends ?? 0) > 1 && !state.error && (
          <p role="status" style={{ margin: 0, fontSize: 14 }}>
            Sent again.
          </p>
        )}
        {state.error && (
          <p role="alert" style={{ margin: 0, color: "var(--wine)", fontSize: 14 }}>
            {state.error}
          </p>
        )}
        <form action={action} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={state.email ?? ""} />
          <ResendButton key={state.sends ?? 0} pending={pending} />
          <button type="button" className="lx-btn" onClick={() => setDismissedFor(state.sends ?? null)}>
            Use a different address
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" style={{ fontSize: 15, fontWeight: 500 }}>
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
