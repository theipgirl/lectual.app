"use client";

import { useActionState, useRef } from "react";
import {
  disconnectAction,
  mapAccountAction,
  refreshAccountsAction,
  unmapAccountAction,
  type LawPayActionState,
} from "@/app/dashboard/settings/integrations/lawpay/actions";

function Status({ state }: { state: LawPayActionState }) {
  if (state.error) {
    return (
      <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
        {state.error}
      </span>
    );
  }
  if (state.message) {
    return (
      <span role="status" className="lx-note">
        {state.message}
      </span>
    );
  }
  return null;
}

export type AccountChoice = { id: string; label: string };

/**
 * Choose the account for ONE role. The role is fixed by the form (hidden
 * input) — never inferred from LawPay's trust flag, which only decides which
 * accounts are offered. No option is preselected, and saving needs the tick.
 */
export function MapAccountForm({ kind, choices, current }: { kind: "operating" | "trust"; choices: AccountChoice[]; current: string | null }) {
  const [state, action, pending] = useActionState<LawPayActionState, FormData>(mapAccountAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="kind" value={kind} />
      <label className="lx-field" style={{ display: "grid", gap: 4 }}>
        <span className="lx-label">{current ? "Change to" : "Account"}</span>
        <select name="account_id" defaultValue="" required className="lx-input">
          <option value="" disabled>
            Choose an account…
          </option>
          {choices.map((c) => (
            <option key={c.id} value={c.id} disabled={c.id === current}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "var(--body)" }}>
        <input type="checkbox" name="confirm" value="yes" required style={{ marginTop: 3 }} />
        <span>
          {kind === "operating"
            ? "I confirm this is the firm's operating account. Earned legal fees clients pay at signing go here."
            : "I confirm this is the firm's trust (IOLTA) account. Lectual never charges an earned fee into it."}
        </span>
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : kind === "operating" ? "Use as operating account" : "Use as trust account"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function UnmapButton({ kind }: { kind: "operating" | "trust" }) {
  const [state, action, pending] = useActionState<LawPayActionState, FormData>(unmapAccountAction, {});
  return (
    <form action={action} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <input type="hidden" name="kind" value={kind} />
      <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
        {pending ? "Removing…" : "Remove"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function RefreshAccountsButton() {
  const [state, action, pending] = useActionState<LawPayActionState>(refreshAccountsAction, {});
  return (
    <form action={action} style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Checking LawPay…" : "Refresh accounts"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function DisconnectLawPayButton({ merchant }: { merchant: string }) {
  const [state, action, pending] = useActionState<LawPayActionState>(disconnectAction, {});
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => dialog.current?.showModal()}>
        Disconnect
      </button>
      <Status state={state} />
      <dialog ref={dialog} className="lx-dialog" aria-labelledby="lp-dc-title">
        <form action={action} onSubmit={() => dialog.current?.close()}>
          <div style={{ padding: 22, display: "grid", gap: 10 }}>
            <h2 id="lp-dc-title" className="lx-h2" style={{ fontSize: 25 }}>
              Disconnect {merchant}?
            </h2>
            <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55 }}>
              Lectual revokes its access at LawPay, deletes the stored credentials and forgets which accounts you chose. Clients stop seeing a
              card form on their proposals. Payments already recorded stay on their quotes.
            </p>
          </div>
          <div className="lx-dialog-foot">
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => dialog.current?.close()}>
              Keep it
            </button>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
