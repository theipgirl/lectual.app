"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  signOutAction,
  switchFirmAction,
  type SwitchFirmState,
} from "@/lib/auth/actions";
import type { SwitchableFirmRef } from "@/lib/firm/session";
import { requestTourAgain } from "@/lib/onboarding/tour";
import { requestFeedback } from "@/lib/feedback/open";
import { requestNameDialog } from "@/lib/account/name";
import { roleLabel } from "@/lib/auth/roles";
import { isOutsidePress, menuKeyAction } from "@/lib/shell/menu-behaviour";
import { HELP_AND_TIPS } from "@/lib/ui/words";

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

  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  const closeMenu = () => menu.current?.removeAttribute("open");
  const avatar = () => menu.current?.querySelector("summary") ?? null;

  // Esc and a press outside close the menu; Esc returns focus to the avatar.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (menuKeyAction(e.key, true) !== "close") return;
      closeMenu();
      avatar()?.focus();
    };
    const onPress = (e: PointerEvent) => {
      if (isOutsidePress(menu.current, e.target)) closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  return (
    <details ref={menu} style={{ position: "relative" }} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        className="lx-avatar"
        style={{ listStyle: "none" }}
        data-tour="account"
        aria-label={`Account: ${name}`}
        title={`${name} · ${roleLabel(role)}`}
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
            {firmName} · {roleLabel(role)}
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

        <div role="menu" aria-label="Account" style={{ display: "grid", gap: 8 }}>
          <button
            type="button"
            role="menuitem"
            className="lx-btn lx-btn-sec lx-btn-sm"
            style={{ width: "100%" }}
            onClick={() => {
              closeMenu();
              requestNameDialog(window, avatar());
            }}
          >
            Your name
          </button>

          <div role="group" aria-labelledby="lx-help-h" style={{ display: "grid", gap: 8 }}>
            <div id="lx-help-h" className="lx-label" style={{ fontSize: 11 }}>
              {HELP_AND_TIPS}
            </div>
            <Link
              href="/dashboard/getting-started/"
              role="menuitem"
              className="lx-btn lx-btn-sec lx-btn-sm"
              style={{ width: "100%" }}
              onClick={closeMenu}
            >
              Getting started
            </Link>
            <button
              type="button"
              role="menuitem"
              className="lx-btn lx-btn-sec lx-btn-sm"
              style={{ width: "100%" }}
              onClick={() => {
                closeMenu();
                requestTourAgain(window);
              }}
            >
              Show tips again
            </button>
            <button
              type="button"
              role="menuitem"
              className="lx-btn lx-btn-sec lx-btn-sm"
              style={{ width: "100%" }}
              onClick={() => {
                closeMenu();
                // Focus returns to the avatar, which stays visible when the menu closes.
                requestFeedback(window, avatar());
              }}
            >
              Send feedback
            </button>
          </div>

          <form action={signOutAction} role="none" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 8 }}>
            <button type="submit" role="menuitem" className="lx-btn lx-btn-ghost lx-btn-sm" style={{ width: "100%" }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
