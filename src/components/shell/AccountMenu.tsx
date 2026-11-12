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
import { requestDealTimesDialog } from "@/lib/deal/person-times";
import { DEAL_TIMES_MENU_ITEM, HELP_AND_TIPS, SETTINGS_NAME } from "@/lib/ui/words";
import type { ViewMenu } from "@/lib/views";
import { ViewSwitch } from "./ViewSwitch";
import "./account-menu.css";

type Props = {
  initials: string;
  name: string;
  email: string | null;
  role: string;
  firmName: string;
  activeOrgId: string;
  switchableFirms: SwitchableFirmRef[];
  /** The View group: Lectual staff acting inside a firm with role views ONLY (viewMenuFor). Absent = not drawn. */
  viewMenu?: ViewMenu;
  /** The owner view has no Settings row in the rail, so Settings is a link here. */
  settingsInMenu?: boolean;
  /** "owner" draws the owner view's menu (the AccountMenu board); absent is today's menu, unchanged. */
  variant?: "owner";
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
  viewMenu,
  settingsInMenu = false,
  variant,
}: Props) {
  const [switchState, switchAction, switching] = useActionState<
    SwitchFirmState,
    FormData
  >(switchFirmAction, {});

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
    <details
      ref={menu}
      style={{ position: "relative" }}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="lx-avatar"
        style={{ listStyle: "none" }}
        data-tour="account"
        aria-label={`Account: ${name}`}
        title={`${name} · ${roleLabel(role)}`}
      >
        {initials}
      </summary>
      {variant === "owner" ? (
        <div className="lx-am">
          <div className="lx-am-head">
            <p className="lx-am-name">{name}</p>
            <p className="lx-am-sub">
              {roleLabel(role)} · {firmName}
            </p>
            {email && <p className="lx-am-sub">{email}</p>}
          </div>

          {switchableFirms.length > 1 && (
            <form action={switchAction} className="lx-am-firm">
              <label className="lx-am-sub" htmlFor="lx-firm">
                Switch firm
              </label>
              <select
                id="lx-firm"
                name="orgId"
                defaultValue={activeOrgId}
                className="lx-input"
              >
                {switchableFirms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="lx-btn lx-btn-sec lx-btn-sm"
                disabled={switching}
              >
                {switching ? "Switching…" : "Open firm"}
              </button>
              {switchState.error && (
                <p
                  role="alert"
                  className="lx-note"
                  style={{ color: "var(--wine)", margin: 0 }}
                >
                  {switchState.error}
                </p>
              )}
            </form>
          )}

          <div role="menu" aria-label="Account" className="lx-am-menu">
            <button
              type="button"
              role="menuitem"
              className="lx-am-item"
              onClick={() => {
                closeMenu();
                requestNameDialog(window, avatar());
              }}
            >
              Your name
            </button>

            <button
              type="button"
              role="menuitem"
              className="lx-am-item"
              onClick={() => {
                closeMenu();
                requestDealTimesDialog(window, avatar());
              }}
            >
              {DEAL_TIMES_MENU_ITEM}
            </button>

            {viewMenu && <ViewSwitch menu={viewMenu} onDone={closeMenu} />}

            {settingsInMenu && (
              <Link
                href="/dashboard/settings/"
                role="menuitem"
                className="lx-am-item lx-am-sep"
                onClick={closeMenu}
              >
                {SETTINGS_NAME}
              </Link>
            )}

            <div
              role="group"
              aria-labelledby="lx-help-h"
              className="lx-am-menu"
            >
              <div
                id="lx-help-h"
                className="lx-am-eyebrow lx-am-eyebrow--tight lx-am-sep"
              >
                {HELP_AND_TIPS}
              </div>
              <Link
                href="/dashboard/getting-started/"
                role="menuitem"
                className="lx-am-item lx-am-item--sm"
                onClick={closeMenu}
              >
                Getting started
              </Link>
              <button
                type="button"
                role="menuitem"
                className="lx-am-item lx-am-item--sm"
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
                className="lx-am-item lx-am-item--sm"
                onClick={() => {
                  closeMenu();
                  // Focus returns to the avatar, which stays visible when the menu closes.
                  requestFeedback(window, avatar());
                }}
              >
                Send feedback
              </button>
            </div>

            <form action={signOutAction} role="none" className="lx-am-sep">
              <button type="submit" role="menuitem" className="lx-am-item">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : (
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
              <label
                className="lx-label"
                style={{ fontSize: 11 }}
                htmlFor="lx-firm"
              >
                Switch firm
              </label>
              <select
                id="lx-firm"
                name="orgId"
                defaultValue={activeOrgId}
                className="lx-input"
              >
                {switchableFirms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="lx-btn lx-btn-sec lx-btn-sm"
                disabled={switching}
              >
                {switching ? "Switching…" : "Open firm"}
              </button>
              {switchState.error && (
                <p
                  role="alert"
                  className="lx-note"
                  style={{ color: "var(--wine)", margin: 0 }}
                >
                  {switchState.error}
                </p>
              )}
            </form>
          )}

          <div
            role="menu"
            aria-label="Account"
            style={{ display: "grid", gap: 8 }}
          >
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

            {settingsInMenu && (
              <Link
                href="/dashboard/settings/"
                role="menuitem"
                className="lx-btn lx-btn-sec lx-btn-sm"
                style={{ width: "100%" }}
                onClick={closeMenu}
              >
                {SETTINGS_NAME}
              </Link>
            )}

            {viewMenu && <ViewSwitch menu={viewMenu} onDone={closeMenu} />}

            <div
              role="group"
              aria-labelledby="lx-help-h"
              style={{ display: "grid", gap: 8 }}
            >
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

            <form
              action={signOutAction}
              role="none"
              style={{ borderTop: "1px solid var(--line-2)", paddingTop: 8 }}
            >
              <button
                type="submit"
                role="menuitem"
                className="lx-btn lx-btn-ghost lx-btn-sm"
                style={{ width: "100%" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </details>
  );
}
