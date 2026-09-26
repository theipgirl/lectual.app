"use client";

import { useActionState } from "react";
import {
  signOutAction,
  switchFirmAction,
  type SwitchFirmState,
} from "@/lib/auth/actions";
import type { SwitchableFirmRef } from "@/lib/firm/session";

type Props = {
  initials: string;
  name: string;
  email: string | null;
  role: string;
  firmName: string;
  activeOrgId: string;
  switchableFirms: SwitchableFirmRef[];
};

/** The avatar at the right of the top bar: who you are, which firm, sign out. */
export function AccountMenu({
  initials,
  name,
  email,
  role,
  firmName,
  activeOrgId,
  switchableFirms,
}: Props) {
  const [switchState, switchAction, switching] = useActionState<SwitchFirmState, FormData>(
    switchFirmAction,
    {},
  );

  return (
    <details style={{ position: "relative" }}>
      <summary
        className="lx-avatar"
        style={{ listStyle: "none" }}
        aria-label={`Account: ${name}`}
        title={`${name} · ${role.replace("_", " ")}`}
      >
        {initials}
      </summary>
      <div
        className="lx-card"
        style={{
          position: "absolute",
          right: 0,
          top: 44,
          width: 280,
          padding: 16,
          zIndex: 60,
          display: "grid",
          gap: 12,
          boxShadow: "var(--shadow-lift)",
        }}
      >
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          {email && <div className="lx-note">{email}</div>}
          <div className="lx-label" style={{ fontSize: 11, marginTop: 6 }}>
            {firmName} · {role.replace("_", " ")}
          </div>
        </div>

        {switchableFirms.length > 1 && (
          <form action={switchAction} style={{ display: "grid", gap: 8 }}>
            <label className="lx-label" style={{ fontSize: 11 }} htmlFor="lx-firm">
              Switch firm
            </label>
            <select id="lx-firm" name="orgId" defaultValue={activeOrgId} className="lx-input">
              {switchableFirms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={switching}>
              {switching ? "Switching…" : "Open firm"}
            </button>
            {switchState.error && (
              <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
                {switchState.error}
              </p>
            )}
          </form>
        )}

        <form action={signOutAction}>
          <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" style={{ width: "100%" }}>
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
