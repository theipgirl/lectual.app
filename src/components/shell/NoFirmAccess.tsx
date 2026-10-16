"use client";

import { useActionState } from "react";
import {
  refreshAccessAction,
  signOutAction,
  type RefreshAccessState,
} from "@/lib/auth/actions";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";

/**
 * Signed in, but a member of no firm visible under RLS. Fails closed with an
 * explanation rather than a redirect loop. The refresh button matters: a
 * just-invited member holds a token minted before the invite (the
 * active_org_id claim is written at token issue), and re-minting it is the
 * only fix they could otherwise find by clearing cookies.
 */
export function NoFirmAccess({ email }: { email: string | null | undefined }) {
  const [state, action, pending] = useActionState<RefreshAccessState, FormData>(
    refreshAccessAction,
    {},
  );

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="lx-card" style={{ maxWidth: 440, padding: 30, display: "grid", gap: 14 }}>
        <div className="lx-label">Lectual</div>
        <h1 className="lx-h2" style={{ fontSize: 31 }}>
          No firm access yet
        </h1>
        <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.6 }}>
          {email ?? "This account"} is signed in, but isn&apos;t a member of a Lectual firm
          workspace. Ask your firm admin to add this email, or sign in with an account that
          already belongs to one.
        </p>
        <form action={action} style={{ display: "grid", gap: 6 }}>
          <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
            {pending ? "Refreshing…" : "Refresh my access"}
          </button>
          <span className="lx-note">
            Just been invited? Your sign-in predates the invite — refresh to pick up your firm.
          </span>
          {state.error && (
            <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
              {state.error}
            </p>
          )}
        </form>
        <form action={signOutAction}>
          <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm">
            Wrong account? Sign out
          </button>
        </form>
        <p className="lx-note" style={{ margin: 0, fontSize: 12 }}>
          {NOT_A_LAW_FIRM_DISCLAIMER}
        </p>
      </div>
    </main>
  );
}
