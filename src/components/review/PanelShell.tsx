"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import "./review.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The drawer around the detail panel: a right-side drawer from 900px, a full-screen sheet below. The page is server
 * rendered from `?open=`; this only adds the keyboard: focus moves in, Tab wraps, Esc follows the close link (so Back
 * and Esc do the same thing), and focus returns to where it was.
 */
export function PanelShell({
  closeHref,
  titleId,
  children,
  placement = "drawer",
}: {
  closeHref: string;
  titleId: string;
  children: ReactNode;
  /**
   * Sprint 10: "centre" draws the same frame as a card centred over the dimmed page (Intake and Matters' opened card).
   * The default, "drawer", is the Weekly review's drawer and renders exactly as before.
   */
  placement?: "drawer" | "centre";
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        root.querySelector<HTMLAnchorElement>("a[data-close]")?.click();
      } else if (e.key === "Tab") {
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className={placement === "centre" ? "rv-panel-wrap rv-panel-wrap-centre" : "rv-panel-wrap"}>
      <Link href={closeHref} className="rv-panel-backdrop" tabIndex={-1} aria-hidden="true" scroll={false} />
      <aside ref={ref} className={placement === "centre" ? "rv-panel rv-panel-centre" : "rv-panel"} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        {children}
      </aside>
    </div>
  );
}
