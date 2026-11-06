"use client";

import { useActionState, useEffect, useState } from "react";
import { SIGN_IN_CODE_LABEL, SIGN_IN_SPAM_HINT } from "@/lib/ui/words";
import { sendMagicLink, verifySignInCode, type CodeState } from "./actions";
import { nextSentState, type SentState } from "./sent-state";

const RESEND_WAIT_SECONDS = 30;

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

/** The 6-digit code from the same email: works even when a mail scanner already opened the link. */
function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(verifySignInCode, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <label htmlFor="code" style={{ fontSize: 14, fontWeight: 500 }}>
        {SIGN_IN_CODE_LABEL}
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          pattern="[0-9 -]*"
          placeholder="123456"
          className="lx-input"
          style={{ maxWidth: 160 }}
        />
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Signing in…" : "Sign in with code"}
        </button>
      </div>
      {state.error && (
        <p role="alert" style={{ margin: 0, color: "var(--wine)", fontSize: 14 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SentState, FormData>(async (prev, formData) => {
    return nextSentState(prev, await sendMagicLink(prev, formData), formData.get("resend") === "1");
  }, {});
  // "Use a different address" hides the confirmation without touching the action state.
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const confirmed = state.ok && dismissedFor !== state.round;

  if (confirmed) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p role="status" style={{ margin: 0, color: "var(--ok)", fontWeight: 500, fontSize: 15 }}>
          We sent a link to {state.email}.
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>{SIGN_IN_SPAM_HINT}</p>
        <CodeForm email={state.email ?? ""} next={next} />
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
          <input type="hidden" name="resend" value="1" />
          <ResendButton key={state.round ?? 0} pending={pending} />
          <button type="button" className="lx-btn" onClick={() => setDismissedFor(state.round ?? null)}>
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
