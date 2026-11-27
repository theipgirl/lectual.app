"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileBarItems, moreSections, railCountFor, type MobileBarSpec, type MoreGroup, type MoreSection, type NavItem } from "@/lib/nav";
import { CloseButton, useDialogKeys } from "@/components/ui/Dialog";
import { Icon as GlyphIcon } from "@/components/ui/Icon";
import { MORE_NAME } from "@/lib/ui/words";
import type { QueueLoadStatus } from "@/lib/queue/load";
import "./owner-shell.css";

type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  /** Owner shell only: the deal-ready words, or null. */
  dealReady?: string | null;
  pendingCount: number;
  counts: Partial<Record<string, number>>;
  /** A view's own bar (default: Today, Intake, Approvals, Mail or Matters). Still filtered through `items`. */
  bar?: MobileBarSpec;
  /** Draw the More button and sheet (default true). The team view turns them off. */
  more?: boolean;
  /** A view's own More sheet groups (default: the rail's groups plus Reports). */
  groups?: readonly MoreGroup[];
  /** Append the Reports group to a view's own groups (the team view; the owner view does not). */
  reports?: boolean;
  /** The owner view: its colours AND its behaviours (the deal-ready dot, the open sheet taking the tile). */
  variant?: "owner";
  /** The owner-style look only (the team view): the same pill bar, none of the owner's behaviours. */
  look?: "owner" | "team";
  /** Draw the More sheet open to start with (default closed). Used by the design harness. */
  initialOpen?: boolean;
};

function Icon({ d }: { d: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The sections the bar does not carry, grouped as the rail groups them. Presentational: the bar owns open/close.
 * One dialog: a header with a Close control, focus moves in, Tab wraps, Esc closes, focus goes back to the opener.
 */
export function MoreSheet({ sections, onClose }: { sections: MoreSection[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeys(ref, { onClose });
  return (
    <div ref={ref} id="lx-more-sheet" className="lx-more" role="dialog" aria-modal="true" aria-label={MORE_NAME} tabIndex={-1}>
      <header className="lx-more-head">
        <span className="lx-more-title">{MORE_NAME}</span>
        <CloseButton onClick={onClose} />
      </header>
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
 * The phone navigation (under 900px, where the rail is hidden): Intake,
 * Approvals, Mail and Matters straight to their lists, and More for the rest.
 * What shows comes from the rail's own visibility, so a section the firm lacks
 * (Mail without the mailbox module) is never offered. The Approvals count
 * keeps the queue's three states. Hiding an entry is a courtesy; every page
 * still checks its own gate.
 */
export function MobileBar({ items, queueStatus, pendingCount, counts, dealReady = null, bar: barSpec, groups, reports = false, more = true, variant, look, initialOpen = false }: Props) {
  const pathname = usePathname() ?? "/dashboard/";
  const [open, setOpen] = useState(initialOpen);
  const lastPath = useRef(pathname);

  // Navigating closes the sheet (the link click already did; this covers back/forward).
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  const bar = mobileBarItems(items, pathname, barSpec);
  const sections = moreSections(items, pathname, groups, barSpec, { reports });

  // The owner's open sheet takes the active tile (PhoneBar board); the page you are on is still named by aria-current.
  const sheetOwnsTile = variant === "owner" && open;
  const moreActive = sections.some((s) => s.items.some((i) => i.active));

  return (
    <>
      <nav className={`lx-mbar${variant === "owner" || look !== undefined ? " lx-mbar--owner" : ""}${look === "team" ? " lx-mbar--team" : ""}`} aria-label="Main">
        {bar.map((item) => {
          const count = railCountFor(item.countKey, queueStatus, pendingCount, counts);
          const ready = variant === "owner" && item.countKey === "queue" ? dealReady : null;
          return (
            <Link
              key={item.slug || "today"}
              href={item.href}
              className={`lx-mbar-item${item.active && !sheetOwnsTile ? " is-active" : ""}`}
              aria-current={item.active ? "page" : undefined}
              aria-label={`${count ? `${item.label} (${count === "!" ? "couldn't reach the queue" : count})` : item.label}${ready ? `, ${ready}` : ""}`}
            >
              <span className="lx-mbar-icon">
                <Icon d={item.icon} />
                {count && <span className={`lx-mbar-badge${count === "!" ? " is-alert" : ""}`}>{count}</span>}
                {ready && <span className="lx-ready-dot lx-ready-dot--bar" aria-hidden="true" />}
              </span>
              <span className="lx-mbar-label">{item.label}</span>
            </Link>
          );
        })}
        {more && (
        <button
          type="button"
          className={`lx-mbar-item${open || moreActive ? " is-active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="lx-more-sheet"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="lx-mbar-icon">
            <GlyphIcon name="more" size={20} />
          </span>
          <span className="lx-mbar-label">{MORE_NAME}</span>
        </button>
        )}
      </nav>
      {more && open && (
        <>
          <div className="lx-more-scrim" onPointerDown={() => setOpen(false)} aria-hidden="true" />
          <MoreSheet sections={sections} onClose={() => setOpen(false)} />
        </>
      )}
    </>
  );
}
