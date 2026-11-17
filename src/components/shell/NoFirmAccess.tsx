"use client";

import { useActionState } from "react";
import {
  refreshAccessAction,
  signOutAction,
  type RefreshAccessState,
} from "@/lib/auth/actions";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import { NO_FIRM_ACCESS_TITLE, NO_FIRM_JUST_INVITED, REFRESH_MY_ACCESS, WRONG_ACCOUNT_SIGN_OUT } from "@/lib/ui/words";
import "./shell-pages.css";

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
    <main className="lx-center lx-center-main">
      <div className="lx-card lx-pad lx-center-card">
        <h1 className="lx-h1">{NO_FIRM_ACCESS_TITLE}</h1>
        <p className="lx-sub">
          <strong>{email ?? "This account"}</strong>{"\u00a0"}is signed in, but isn&apos;t a member of a Lectual firm
          workspace. Ask your firm admin to add this email, or sign in with an account that
          already belongs to one.
        </p>
        <form action={action} className="lx-center-form">
          <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
            {pending ? "Refreshing…" : REFRESH_MY_ACCESS}
          </button>
          <span className="lx-note">{NO_FIRM_JUST_INVITED}</span>
          {state.error && (
            <p role="alert" className="lx-center-error">
              {state.error}
            </p>
          )}
        </form>
        <form action={signOutAction}>
          <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm">
            {WRONG_ACCOUNT_SIGN_OUT}
          </button>
        </form>
        <p className="lx-note">{NOT_A_LAW_FIRM_DISCLAIMER}</p>
      </div>
    </main>
  );
}
