"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  switchFirmAction,
  type SwitchFirmState,
} from "@/lib/auth/actions";
import { SIGN_OUT_PATH, TEAM_SETTINGS_PATH, VIEW_AS_EXIT_PATH } from "@/lib/views/view-as-rules";
import type { SwitchableFirmRef } from "@/lib/firm/session";
import { requestTourAgain } from "@/lib/onboarding/tour";
import { requestWelcomeAgain } from "@/lib/onboarding/welcome-deal";
import { requestFeedback } from "@/lib/feedback/open";
import { requestNameDialog } from "@/lib/account/name";
import { roleLabel } from "@/lib/auth/roles";
import { isOutsidePress, menuKeyAction } from "@/lib/shell/menu-behaviour";
import { requestDealTimesDialog } from "@/lib/deal/person-times";
import { DEAL_TIMES_MENU_ITEM, HELP_AND_TIPS, SETTINGS_NAME, SAVING, VIEW_AS_EXIT, VIEW_AS_MENU, VIEW_AS_MENU_HEADER } from "@/lib/ui/words";
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
  /** The deck behaviours (the Deal times item). Default: the owner variant. */
  deck?: boolean;
  /** The owner-style look only (the team view): the same menu layout, without the welcome deal; Deal times only with `deck`. */
  look?: "owner" | "team";
  /** A real owner on a database with View as: one "View as a teammate" line, linking to Team. */
  viewAsLink?: boolean;
  /** While previewing a teammate: the menu holds only "Viewing as <name>", Exit and Sign out (spec "Account menu"). */
  previewing?: { name: string };
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
  deck,
  look,
  viewAsLink = false,
  previewing,
}: Props) {
  const [switchState, switchAction, switching] = useActionState<
    SwitchFirmState,
    FormData
  >(switchFirmAction, {});

  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  const closeMenu = () => menu.current?.removeAttribute("open");
  // "Show tips again": the owner view replays the welcome deal, every other view the tour.
  const replayGuide = () => (variant === "owner" ? requestWelcomeAgain(window) : requestTourAgain(window));
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
      className="lx-am-root"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={previewing ? "lx-avatar lx-am-avatar lx-am-avatar--preview" : "lx-avatar lx-am-avatar"}
        data-tour="account"
        aria-label={`Account: ${name}`}
        title={`${name} · ${roleLabel(role)}`}
      >
        {initials}
      </summary>
      {previewing ? (
        <div className="lx-am">
          <div className="lx-am-head">
            <p className="lx-am-name">{VIEW_AS_MENU_HEADER(previewing.name)}</p>
          </div>
          <div role="menu" aria-label="Account" className="lx-am-menu">
            <form action={VIEW_AS_EXIT_PATH} method="post" role="none">
              <button type="submit" role="menuitem" className="lx-am-item">
                {VIEW_AS_EXIT}
              </button>
            </form>
            <form action={SIGN_OUT_PATH} method="post" role="none" className="lx-am-sep">
              <button type="submit" role="menuitem" className="lx-am-item">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : variant === "owner" || look !== undefined ? (
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
                {switching ? SAVING : "Open firm"}
              </button>
              {switchState.error && (
                <p role="alert" className="lx-am-error">
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

            {(deck ?? variant === "owner") && (
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
            )}

            {viewMenu && <ViewSwitch menu={viewMenu} onDone={closeMenu} />}

            {viewAsLink && (
              <Link href={TEAM_SETTINGS_PATH} role="menuitem" className="lx-am-item" onClick={closeMenu}>
                {VIEW_AS_MENU}
              </Link>
            )}

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
                className="lx-label lx-am-eyebrow lx-am-eyebrow--tight lx-am-sep"
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
                  replayGuide();
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

            <form action={SIGN_OUT_PATH} method="post" role="none" className="lx-am-sep">
              <button type="submit" role="menuitem" className="lx-am-item">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="lx-card lx-am-plain">
          <div>
            <div className="lx-am-name">{name}</div>
            {email && <div className="lx-note">{email}</div>}
            <div className="lx-label lx-am-firmline">
              {firmName} · {roleLabel(role)}
            </div>
          </div>

          {switchableFirms.length > 1 && (
            <form action={switchAction} className="lx-am-stack">
              <label className="lx-label" htmlFor="lx-firm">
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
                {switching ? SAVING : "Open firm"}
              </button>
              {switchState.error && (
                <p role="alert" className="lx-am-error">
                  {switchState.error}
                </p>
              )}
            </form>
          )}

          <div role="menu" aria-label="Account" className="lx-am-stack">
            <button
              type="button"
              role="menuitem"
              className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn"
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
                className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn"
                onClick={closeMenu}
              >
                {SETTINGS_NAME}
              </Link>
            )}

            {viewMenu && <ViewSwitch menu={viewMenu} onDone={closeMenu} />}

            {viewAsLink && (
              <Link href={TEAM_SETTINGS_PATH} role="menuitem" className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn" onClick={closeMenu}>
                {VIEW_AS_MENU}
              </Link>
            )}

            <div role="group" aria-labelledby="lx-help-h" className="lx-am-stack">
              <div id="lx-help-h" className="lx-label">
                {HELP_AND_TIPS}
              </div>
              <Link
                href="/dashboard/getting-started/"
                role="menuitem"
                className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn"
                onClick={closeMenu}
              >
                Getting started
              </Link>
              <button
                type="button"
                role="menuitem"
                className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn"
                onClick={() => {
                  closeMenu();
                  replayGuide();
                }}
              >
                Show tips again
              </button>
              <button
                type="button"
                role="menuitem"
                className="lx-btn lx-btn-sec lx-btn-sm lx-am-btn"
                onClick={() => {
                  closeMenu();
                  // Focus returns to the avatar, which stays visible when the menu closes.
                  requestFeedback(window, avatar());
                }}
              >
                Send feedback
              </button>
            </div>

            <form action={SIGN_OUT_PATH} method="post" role="none" className="lx-am-signout">
              <button type="submit" role="menuitem" className="lx-btn lx-btn-ghost lx-btn-sm lx-am-btn">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </details>
  );
}
