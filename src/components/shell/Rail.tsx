"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RAIL_PIN_COOKIE, type NavItem } from "@/lib/nav";
import type { QueueLoadStatus } from "@/lib/queue/load";


type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  pendingCount: number;
  /** Section counts for the pinned rail, keyed by slug. Absent = unknown, never 0. */
  counts: Partial<Record<string, number>>;
  initialPinned: boolean;
};

function isActive(pathname: string, item: NavItem): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (item.slug === "") return path === "/dashboard/";
  return path.startsWith(item.href) || (item.also ?? []).some((prefix) => path.startsWith(prefix));
}

const PIN_ICON = "M9 4h6l-1 5 3 3H7l3-3zM12 12v8";
const COLLAPSE_ICON = "M15 6l-6 6 6 6";

/**
 * The floating oxblood rail from the design. Collapsed it is the 62px icon
 * column with a named tooltip on hover; pinned (the prototype's `railPinned`)
 * it opens to a 262px panel with each section's name and count.
 *
 * The Queue badge carries all three queue states: a count when we reached it,
 * "!" when we could not (so an outage never reads as "nothing waiting"),
 * nothing when there is no queue.
 */
export function Rail({ items, queueStatus, pendingCount, counts, initialPinned }: Props) {
  const pathname = usePathname() ?? "/dashboard/";
  const [pinned, setPinned] = useState(initialPinned);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    document.cookie = `${RAIL_PIN_COOKIE}=${next ? "pinned" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className={`lx-rail-slot${pinned ? " is-pinned" : ""}`}>
      <nav className={`lx-rail${pinned ? " is-pinned" : ""}`} aria-label="Sections">
        {items.map((item, i) => {
          const sep = i > 0 && items[i - 1].group !== item.group;
          const active = isActive(pathname, item);
          const queueBadge =
            item.slug !== "queue"
              ? null
              : queueStatus === "unavailable"
                ? "!"
                : queueStatus === "ok" && pendingCount > 0
                  ? String(pendingCount > 99 ? "99+" : pendingCount)
                  : null;
          const count = item.slug === "queue" ? (queueStatus === "ok" ? pendingCount : undefined) : counts[item.slug];
          const label =
            queueBadge === "!"
              ? `${item.label} — couldn't reach the queue`
              : queueBadge
                ? `${item.label} — ${queueBadge} waiting`
                : item.label;
          return (
            <span key={item.slug} style={{ display: "contents" }}>
              {sep && <span className="lx-rail-sep" aria-hidden="true" />}
              <Link href={item.href} className="lx-rail-item" aria-current={active ? "page" : undefined} aria-label={label}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={item.icon} />
                </svg>
                {queueBadge && !pinned && <span className="lx-rail-badge">{queueBadge}</span>}
                <span className="lx-rail-name">{item.label}</span>
                {pinned && (queueBadge === "!" ? (
                  <span className="lx-rail-count is-alert">!</span>
                ) : count !== undefined ? (
                  <span className="lx-rail-count">{count > 999 ? "999+" : count}</span>
                ) : null)}
                {!pinned && <span className="lx-rail-tip" aria-hidden="true">{label}</span>}
              </Link>
            </span>
          );
        })}
        <span className="lx-rail-spacer" />
        <button
          type="button"
          className="lx-rail-item lx-rail-pin"
          onClick={togglePin}
          aria-pressed={pinned}
          aria-label={pinned ? "Collapse the menu" : "Pin the menu open"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={pinned ? COLLAPSE_ICON : PIN_ICON} />
          </svg>
          <span className="lx-rail-name">{pinned ? "Collapse" : "Pin open"}</span>
          {!pinned && <span className="lx-rail-tip" aria-hidden="true">Pin the menu open</span>}
        </button>
      </nav>
    </div>
  );
}
