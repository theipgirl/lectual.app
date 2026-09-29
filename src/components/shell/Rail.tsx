"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/auth/actions";
import { ICON, RAIL_PIN_COOKIE, isNavActive, navItemBySlug, railGroups, type NavItem } from "@/lib/nav";
import type { QueueLoadStatus } from "@/lib/queue/load";

type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  pendingCount: number;
  /** Section counts keyed by slug. Absent = unknown, and nothing is drawn (never a false 0). */
  counts: Partial<Record<string, number>>;
  initialPinned: boolean;
  initials: string;
  name: string;
};

const PIN = "M9 4h6M12 4v6M7 10h10l-1 5H8zM12 15v5";

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
 * (beside it). Sections are grouped as in the design, parents show their
 * children when open, and a collapsed section with a count shows a dot.
 *
 * The Queue count carries all three queue states: a number when we reached
 * it, "!" when we could not (an outage never reads as "nothing waiting"),
 * nothing when there is no queue.
 */
export function Rail({ items, queueStatus, pendingCount, counts, initialPinned, initials, name }: Props) {
  const pathname = usePathname() ?? "/dashboard/";
  const [pinned, setPinned] = useState(initialPinned);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    document.cookie = `${RAIL_PIN_COOKIE}=${next ? "pinned" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  function countFor(key: string | null): string | null {
    if (!key) return null;
    if (key === "queue") {
      if (queueStatus === "unavailable") return "!";
      return queueStatus === "ok" && pendingCount > 0 ? String(pendingCount > 99 ? "99+" : pendingCount) : null;
    }
    const n = counts[key];
    return n === undefined || n === 0 ? null : String(n > 999 ? "999+" : n);
  }

  const groups = railGroups(items, pathname);
  const settings = items.find((i) => i.slug === "settings") ?? navItemBySlug("settings")!;
  const settingsActive = isNavActive(pathname, settings);

  return (
    <div className={`lx-rail-slot${pinned ? " is-pinned" : ""}`}>
      <nav className={`lx-rail${pinned ? " is-pinned" : ""}`} aria-label="Sections">
        <div className="lx-rail-headrow">
          <span className="lx-rail-kicker">Navigate</span>
          <button
            type="button"
            className={`lx-rail-pin${pinned ? " is-on" : ""}`}
            onClick={togglePin}
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
                return (
                  <div key={entry.key} className="lx-rail-node">
                    <Link
                      href={entry.href}
                      className={`lx-rail-item${entry.active ? " is-active" : entry.childActive ? " is-parent" : ""}`}
                      aria-current={entry.active ? "page" : undefined}
                      aria-label={count ? `${entry.label} (${count === "!" ? "couldn't reach the queue" : count})` : entry.label}
                    >
                      <span className="lx-rail-icon">
                        <Icon d={entry.icon} size={17} />
                        {count && !entry.active && <span className={`lx-rail-dot${count === "!" ? " is-alert" : ""}`} aria-hidden="true" />}
                      </span>
                      <span className="lx-rail-label">{entry.label}</span>
                      {count && <span className={`lx-rail-count${count === "!" ? " is-alert" : ""}`}>{count}</span>}
                    </Link>
                    {entry.kids.length > 0 && (
                      <div className="lx-rail-kids">
                        {entry.kids.map((kid) => {
                          const kc = countFor(kid.countKey);
                          return (
                            <Link
                              key={kid.key}
                              href={kid.href}
                              className={`lx-rail-kid${kid.active ? " is-active" : ""}`}
                              aria-current={kid.active ? "page" : undefined}
                            >
                              <Icon d={kid.icon} size={13} />
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

        <div className="lx-rail-rule" aria-hidden="true" />

        <Link
          href={settings.href}
          className={`lx-rail-item lx-rail-settings${settingsActive ? " is-active" : ""}`}
          aria-current={settingsActive ? "page" : undefined}
          aria-label="Settings"
        >
          <span className="lx-rail-icon">
            <Icon d={ICON.sliders} size={17} />
          </span>
          <span className="lx-rail-label">Settings</span>
        </Link>

        <div className="lx-rail-me">
          <span className="lx-rail-avatar" title={name}>
            {initials}
          </span>
          <span className="lx-rail-label lx-rail-mewho">
            <span className="lx-rail-mename">{name}</span>
            <span className="lx-rail-meact">
              <Link href="/dashboard/settings/firm/">Profile</Link> ·{" "}
              <form action={signOutAction} style={{ display: "inline" }}>
                <button type="submit">Sign out</button>
              </form>
            </span>
          </span>
        </div>
      </nav>
    </div>
  );
}
