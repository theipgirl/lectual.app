"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICON, RAIL_PIN_COOKIE, isNavActive, navItemBySlug, railCountFor, railGroups, visibleReports, REPORTS_INDEX, type NavItem, type RailNode } from "@/lib/nav";
import { RAIL_COUNT_TITLE } from "@/lib/intake/counts";
import { navTourToken } from "@/lib/onboarding/tour";
import { closeRailOnEscape, releaseRailFocus } from "@/lib/rail-behaviour";
import { MORE_NAME, OWNER_VIEW_NAME } from "@/lib/ui/words";
import type { QueueLoadStatus } from "@/lib/queue/load";
import "./owner-shell.css";

type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  /** Owner shell only: the deal-ready words ("Your 2:00 PM deal is ready \u00b7 3 cards"), or null. */
  dealReady?: string | null;
  pendingCount: number;
  /** Section counts keyed by slug. Absent = unknown, and nothing is drawn (never a false 0). */
  counts: Partial<Record<string, number>>;
  initialPinned: boolean;
  /** Draw the Settings row at the bottom (default: yes, today's rail). The owner view keeps Settings in the account menu. */
  showSettings?: boolean;
  /** Draw the Reports row above Settings when a report is visible (default: yes). */
  showReports?: boolean;
  /** The rail's shape (default: RAIL_TREE). A view's own tree; it only ever names slugs that `items` allowed. */
  tree?: readonly (readonly RailNode[])[];
  /** The owner view's colours. */
  variant?: "owner";
  /** Owner view, collapsed rail: draw the More menu open to start with (default closed). Used by the design harness. */
  initialFlyout?: boolean;
};

const PIN = "M9 4h6M12 4v6M7 10h10l-1 5H8zM12 15v5";
const CHEVRON = "M6 9l6 6 6-6";

function Icon({ d, size }: { d: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The navigation rail from design/Rail.dc.html: a 62px glass column that
 * opens to 262px while hovered (over the page) or stays open when pinned
 * (beside it; pinned is the default, see railIsPinned). Who you are and Sign
 * out live in the top-right account menu only. On a phone this column is
 * hidden and MobileBar takes over. Sections are grouped as in the design, parents show their
 * children when open, and a collapsed section with a count shows a dot.
 *
 * The Approvals count carries all three queue states: a number when we reached
 * it, "!" when we could not (an outage never reads as "nothing waiting"),
 * nothing when there is no queue.
 */
export function Rail({ items, queueStatus, pendingCount, counts, initialPinned, dealReady = null, showSettings = true, showReports: reportsAllowed = true, tree, variant, initialFlyout = false }: Props) {
  const pathname = usePathname() ?? "/dashboard/";
  const [pinned, setPinned] = useState(initialPinned);
  const [flyout, setFlyout] = useState(initialFlyout);
  const slot = useRef<HTMLDivElement>(null);
  const owner = variant === "owner";

  // The owner's collapsed More menu closes on Escape and on a pointer-down outside it.
  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFlyout(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!slot.current?.contains(e.target as Node)) setFlyout(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [flyout]);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    document.cookie = `${RAIL_PIN_COOKIE}=${next ? "pinned" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  // A mouse click must not leave focus in the rail (it would stay open), and Escape closes it.
  const releaseFocus = () => releaseRailFocus(document.activeElement as HTMLElement | null);

  const countFor = (key: string | null) => railCountFor(key, queueStatus, pendingCount, counts);

  const groups = railGroups(items, pathname, tree);
  const settings = items.find((i) => i.slug === "settings") ?? navItemBySlug("settings")!;
  const settingsActive = isNavActive(pathname, settings);
  // One Reports row above Settings, only for a firm and role that can see at least one report.
  const showReports = reportsAllowed && visibleReports(items).length > 0;
  const reportsActive = pathname.startsWith(REPORTS_INDEX);
  const moreEntry = groups.flat().find((e) => e.kids.length > 0);

  return (
    <div ref={slot} className={`lx-rail-slot${pinned ? " is-pinned" : ""}`}>
      <nav
        className={`lx-rail${pinned ? " is-pinned" : ""}${variant === "owner" ? " lx-rail--owner" : ""}`}
        aria-label="Sections"
        data-tour="rail"
        onKeyDown={(e) => closeRailOnEscape(e.key, e.currentTarget, document.activeElement as HTMLElement | null)}
      >
        <div className="lx-rail-headrow">
          <span className="lx-rail-kicker">{owner ? OWNER_VIEW_NAME : "Navigate"}</span>
          <button
            type="button"
            className={`lx-rail-pin${pinned ? " is-on" : ""}`}
            onClick={(e) => {
              togglePin();
              // detail is 0 for a keyboard activation: that user keeps their place in the rail.
              if (e.detail > 0) releaseFocus();
            }}
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin navigation" : "Pin navigation"}
            data-tip={pinned ? "Unpin navigation" : "Pin navigation"}
          >
            <Icon d={PIN} size={13} />
          </button>
        </div>

        <div className="lx-rail-scroll">
          {groups.map((group, gi) => (
            <div key={gi} className="lx-rail-group">
              {gi > 0 && <div className="lx-rail-spacer" aria-hidden="true" />}
              {group.map((entry) => {
                const count = countFor(entry.countKey);
                const ready = owner && entry.countKey === "queue" ? dealReady : null;
                return (
                  <div key={entry.key} className="lx-rail-node">
                    <Link
                      href={entry.href}
                      onClick={(e) => {
                        // The owner's More row, on a collapsed rail nobody is pointing at: open its menu instead of the first list.
                        if (owner && entry.kids.length > 0 && !e.currentTarget.closest(".lx-rail")?.matches(":hover, :has(:focus-visible), .is-pinned")) {
                          e.preventDefault();
                          setFlyout((o) => !o);
                          return;
                        }
                        releaseFocus();
                      }}
                      data-tour={(entry.kids.length > 0 ? entry.kids.map((k) => k.key) : [entry.key]).map(navTourToken).join(" ")}
                      className={`lx-rail-item${entry.active ? " is-active" : entry.childActive ? " is-parent" : ""}`}
                      aria-current={entry.active ? "page" : undefined}
                      aria-label={`${count ? `${entry.label} (${count === "!" ? "couldn't reach the queue" : count})` : entry.label}${ready ? `, ${ready}` : ""}`}
                      title={count && entry.countKey ? RAIL_COUNT_TITLE[entry.countKey] : undefined}
                    >
                      <span className="lx-rail-icon">
                        <Icon d={entry.icon} size={17} />
                        {ready && !entry.active ? (
                          <span className="lx-rail-dot is-ready" aria-hidden="true" />
                        ) : (
                          count && !entry.active && <span className={`lx-rail-dot${count === "!" ? " is-alert" : ""}`} aria-hidden="true" />
                        )}
                      </span>
                      <span className="lx-rail-label">{entry.label}</span>
                      {ready && <span className="lx-ready-dot" aria-hidden="true" />}
                      {count && <span className={`lx-rail-count${count === "!" ? " is-alert" : ""}`}>{count}</span>}
                      {owner && entry.kids.length > 0 && (
                        <span className="lx-rail-chev">
                          <Icon d={CHEVRON} size={13} />
                        </span>
                      )}
                    </Link>
                    {entry.kids.length > 0 && (
                      <div className="lx-rail-kids">
                        {entry.kids.map((kid) => {
                          const kc = countFor(kid.countKey);
                          return (
                            <Link
                              key={kid.key}
                              href={kid.href}
                              onClick={releaseFocus}
                              data-tour={navTourToken(kid.key)}
                              className={`lx-rail-kid${kid.active ? " is-active" : ""}`}
                              aria-current={kid.active ? "page" : undefined}
                              title={kc ? RAIL_COUNT_TITLE[kid.countKey] : undefined}
                            >
                              {!owner && <Icon d={kid.icon} size={13} />}
                              <span className="lx-rail-label">{kid.label}</span>
                              {kc && <span className={`lx-rail-kidcount${kc === "!" ? " is-alert" : ""}`}>{kc}</span>}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {(showReports || showSettings) && <div className="lx-rail-rule" aria-hidden="true" />}

        {showReports && (
          <Link
            href={REPORTS_INDEX}
            onClick={releaseFocus}
            className={`lx-rail-item lx-rail-reports${reportsActive ? " is-active" : ""}`}
            aria-current={reportsActive ? "page" : undefined}
            aria-label="Reports"
          >
            <span className="lx-rail-icon">
              <Icon d={ICON.bars} size={17} />
            </span>
            <span className="lx-rail-label">Reports</span>
          </Link>
        )}

        {showSettings && (
        <Link
          href={settings.href}
          onClick={releaseFocus}
          data-tour={navTourToken("settings")}
          className={`lx-rail-item lx-rail-settings${settingsActive ? " is-active" : ""}`}
          aria-current={settingsActive ? "page" : undefined}
          aria-label="Settings"
        >
          <span className="lx-rail-icon">
            <Icon d={ICON.sliders} size={17} />
          </span>
          <span className="lx-rail-label">Settings</span>
        </Link>
        )}
      </nav>
      {owner && flyout && moreEntry && (
        <div className="lx-rail-flyout" role="menu" aria-label={MORE_NAME}>
          <span className="lx-rail-flyout-label">{MORE_NAME}</span>
          {moreEntry.kids.map((kid) => (
            <Link
              key={kid.key}
              href={kid.href}
              role="menuitem"
              onClick={() => setFlyout(false)}
              className={`lx-rail-flyout-item${kid.active ? " is-active" : ""}`}
              aria-current={kid.active ? "page" : undefined}
            >
              {kid.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
