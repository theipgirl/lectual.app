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
    <button type="submit" className="lx-si-btn" disabled={pending || secondsLeft > 0}>
      {pending ? "Sending…" : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend the link"}
    </button>
  );
}

/** The 6-digit code from the same email: works even when a mail scanner already opened the link. */
function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(verifySignInCode, {});
  return (
    <form action={action} className="lx-si-form">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <label htmlFor="code" className="lx-si-label">
        {SIGN_IN_CODE_LABEL}
      </label>
      <div className="lx-si-code-row">
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          pattern="[0-9 -]*"
          placeholder="123456"
          className="lx-si-input"
        />
        <button type="submit" className="lx-si-btn lx-si-btn-pri" disabled={pending}>
          {pending ? "Signing in…" : "Sign in with code"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="lx-si-err">
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
      <div className="lx-si-sent">
        <p role="status" className="lx-si-sent-head">
          We sent a link to {state.email}.
        </p>
        <p className="lx-si-note">{SIGN_IN_SPAM_HINT}</p>
        <CodeForm email={state.email ?? ""} next={next} />
        {(state.sends ?? 0) > 1 && !state.error && (
          <p role="status" className="lx-si-note">
            Sent again.
          </p>
        )}
        {state.error && (
          <p role="alert" className="lx-si-err">
            {state.error}
          </p>
        )}
        <form action={action} className="lx-si-row">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={state.email ?? ""} />
          <input type="hidden" name="resend" value="1" />
          <ResendButton key={state.round ?? 0} pending={pending} />
          <button type="button" className="lx-si-btn" onClick={() => setDismissedFor(state.round ?? null)}>
            Use a different address
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="lx-si-form">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="lx-si-label">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourfirm.com"
        className="lx-si-input"
      />
      <button type="submit" className="lx-si-btn lx-si-btn-pri" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state.error && (
        <p role="alert" className="lx-si-err">
          {state.error}
        </p>
      )}
    </form>
  );
}
