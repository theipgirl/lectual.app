"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CopilotChat } from "./CopilotChat";
import { FOCUSABLE_SELECTOR, focusFirstInput, launcherKeyAction, nextTabFocus, shouldShowLauncher } from "@/lib/copilot/launcher";
import "./copilot.css";

const DRAWER_TITLE_ID = "copilot-drawer-title";

/** The right-hand drawer: a labelled dialog around the same chat the copilot page uses. */
export function CopilotDrawer(props: {
  open: boolean;
  pathname: string;
  onClose: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  drawerRef?: React.Ref<HTMLElement>;
}) {
  const { open, pathname, onClose, onKeyDown, drawerRef } = props;
  return (
    <>
      <div className="cpd-scrim" hidden={!open} onClick={onClose} />
      <aside ref={drawerRef} className="cpd-drawer" role="dialog" aria-modal="true" aria-labelledby={DRAWER_TITLE_ID} hidden={!open} onKeyDown={onKeyDown}>
        <div className="cpd-head">
          <h2 id={DRAWER_TITLE_ID} className="cpd-title">
            AI copilot
          </h2>
          <span className="cpd-kbd" aria-hidden="true">
            Esc to close
          </span>
          <button type="button" className="cpd-close" onClick={onClose}>
            Close
          </button>
        </div>
        <CopilotChat variant="drawer" pathname={pathname} />
      </aside>
    </>
  );
}

/**
 * The floating copilot: a bottom-right button that opens a right-hand drawer
 * holding the same chat as /dashboard/copilot/, on every other dashboard page.
 * Command-J (Ctrl-J elsewhere) toggles it, Esc closes it, Tab stays inside it
 * while it is open, and closing returns focus to the button.
 *
 * It sends the page it is on (the pathname, and the lead or matter id parsed
 * from it) so "this lead" works. The server parses the pathname again and
 * re-reads the record itself; the browser's id is never what gets read.
 *
 * Renders nothing on the copilot page and wherever AI isn't configured. Once
 * opened it stays mounted (hidden when closed), so a thread and a streaming
 * answer survive closing the drawer.
 */
export function CopilotLauncher({ configured }: { configured: boolean }) {
  const pathname = usePathname() ?? "";
  const active = shouldShowLauncher({ pathname, configured });
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setEverOpened(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = launcherKeyAction(e, { active, open });
      if (!action) return;
      if (action.preventDefault) e.preventDefault();
      setOpenState(action.open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, open, setOpenState]);

  // Focus moves into the drawer's input on open, and back to the button on close.
  useEffect(() => {
    if (open) focusFirstInput(drawerRef.current);
    else if (wasOpen.current) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!active) return null;

  function trapTab(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab" || !drawerRef.current) return;
    const items = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const target = nextTabFocus({ count: items.length, current: items.indexOf(document.activeElement as HTMLElement), shift: e.shiftKey });
    if (target === null) return;
    e.preventDefault();
    items[target].focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cpd-launcher"
        data-tour="copilot"
        aria-label="Ask the copilot"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ask the copilot (Command-J)"
        onClick={() => setOpenState(!open)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.7A8 8 0 1 1 21 12z" />
        </svg>
      </button>

      {everOpened && (
        <CopilotDrawer open={open} pathname={pathname} onClose={() => setOpenState(false)} onKeyDown={trapTab} drawerRef={drawerRef} />
      )}
    </>
  );
}
