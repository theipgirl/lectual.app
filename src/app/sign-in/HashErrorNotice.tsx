"use client";

import { useEffect, useSyncExternalStore } from "react";
import { hashErrorCode, signInErrorMessage } from "@/lib/auth/sign-in-errors";

// Read once per page load: the fragment is cleared right after, and the notice must stay.
let captured: string | null | undefined;
function readCode(): string | null {
  if (captured === undefined) captured = hashErrorCode(window.location.hash);
  return captured;
}
const noSubscribe = () => () => {};

/**
 * Shows the expired-link sentence when Supabase bounced a magic link back with the reason in the
 * URL fragment (the server can't read it), then clears the fragment so a reload doesn't repeat it.
 */
export default function HashErrorNotice({ serverError }: { serverError: boolean }) {
  const code = useSyncExternalStore(noSubscribe, readCode, () => null);
  useEffect(() => {
    if (code) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [code]);
  if (serverError || !code) return null;
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.5,
        color: "var(--wine)",
        background: "rgba(142,39,51,.07)",
        border: "1px solid rgba(142,39,51,.3)",
        borderRadius: 9,
        padding: "10px 12px",
      }}
    >
      {signInErrorMessage(code)}
    </p>
  );
}
