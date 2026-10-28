"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileBarItems, moreSections, railCountFor, type MoreSection, type NavItem } from "@/lib/nav";
import { focusRestoreTarget, tourKeyAction } from "@/lib/onboarding/engine";
import { menuKeyAction } from "@/lib/shell/menu-behaviour";
import { MORE_NAME } from "@/lib/ui/words";
import type { QueueLoadStatus } from "@/lib/queue/load";

type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  pendingCount: number;
  counts: Partial<Record<string, number>>;
};

const MORE_ICON = "M5 12h.01M12 12h.01M19 12h.01";

function Icon({ d }: { d: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The sections the bar does not carry, grouped as the rail groups them. Presentational: the bar owns open/close. */
export function MoreSheet({ sections, onClose, sheetRef }: { sections: MoreSection[]; onClose: () => void; sheetRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={sheetRef} id="lx-more-sheet" className="lx-more" role="dialog" aria-modal="true" aria-label={MORE_NAME}>
      {sections.map((section) => (
        <div key={section.label} className="lx-more-group">
          <div className="lx-more-label">{section.label}</div>
          {section.items.map((item) => (
            <Link key={item.slug || "today"} href={item.href} onClick={onClose} className="lx-more-link" aria-current={item.active ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The phone navigation (under 900px, where the rail is hidden): Leads,
 * Approvals, Mail and Matters straight to their lists, and More for the rest.
 * What shows comes from the rail's own visibility, so a section the firm lacks
 * (Mail without the mailbox module) is never offered. The Approvals count
 * keeps the queue's three states. Hiding an entry is a courtesy; every page
 * still checks its own gate.
 */
export function MobileBar({ items, queueStatus, pendingCount, counts }: Props) {
  const pathname = usePathname() ?? "/dashboard/";
  const [open, setOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const lastPath = useRef(pathname);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) focusRestoreTarget(moreButton.current)?.focus();
  };

  // Navigating closes the sheet (the link click already did; this covers back/forward).
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  // Escape closes the sheet wherever focus is, and focus goes back to More.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (menuKeyAction(e.key, true) === "close") {
        setOpen(false);
        focusRestoreTarget(moreButton.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) sheet.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open]);

  const bar = mobileBarItems(items, pathname);
  const sections = moreSections(items, pathname);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const controls = [...(sheet.current?.querySelectorAll<HTMLElement>("a") ?? [])];
    const current = controls.findIndex((el) => el === e.target);
    const action = tourKeyAction({ key: e.key, shiftKey: e.shiftKey, inField: false }, { count: controls.length, current });
    if (action?.kind !== "focus") return;
    e.preventDefault();
    controls[action.index]?.focus();
  };

  const moreActive = sections.some((s) => s.items.some((i) => i.active));

  return (
    <>
      <nav className="lx-mbar" aria-label="Main">
        {bar.map((item) => {
          const count = railCountFor(item.countKey, queueStatus, pendingCount, counts);
          return (
            <Link
              key={item.slug}
              href={item.href}
              className={`lx-mbar-item${item.active ? " is-active" : ""}`}
              aria-current={item.active ? "page" : undefined}
              aria-label={count ? `${item.label} (${count === "!" ? "couldn't reach the queue" : count})` : item.label}
            >
              <span className="lx-mbar-icon">
                <Icon d={item.icon} />
                {count && <span className={`lx-mbar-badge${count === "!" ? " is-alert" : ""}`}>{count}</span>}
              </span>
              <span className="lx-mbar-label">{item.label}</span>
            </Link>
          );
        })}
        <button
          ref={moreButton}
          type="button"
          className={`lx-mbar-item${open || moreActive ? " is-active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="lx-more-sheet"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="lx-mbar-icon">
            <Icon d={MORE_ICON} />
          </span>
          <span className="lx-mbar-label">{MORE_NAME}</span>
        </button>
      </nav>
      {open && (
        <div onKeyDown={onKeyDown}>
          <div className="lx-more-scrim" onPointerDown={() => close(false)} aria-hidden="true" />
          <MoreSheet sections={sections} sheetRef={sheet} onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

