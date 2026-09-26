"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";
import type { QueueLoadStatus } from "@/lib/queue/load";

type Props = {
  items: NavItem[];
  queueStatus: QueueLoadStatus;
  pendingCount: number;
};

function isActive(pathname: string, item: NavItem): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (item.slug === "") return path === "/dashboard/";
  return path.startsWith(item.href);
}

/**
 * The floating oxblood rail from the design. The Queue badge carries all
 * three queue states: a count when we reached it, "!" when we could not (so
 * an outage never reads as "nothing waiting"), nothing when there is no queue.
 */
export function Rail({ items, queueStatus, pendingCount }: Props) {
  const pathname = usePathname() ?? "/dashboard/";

  return (
    <nav className="lx-rail" aria-label="Sections">
      {items.map((item, i) => {
        const sep = i > 0 && items[i - 1].group !== item.group;
        const active = isActive(pathname, item);
        const badge =
          item.slug !== "queue"
            ? null
            : queueStatus === "unavailable"
              ? "!"
              : queueStatus === "ok" && pendingCount > 0
                ? String(pendingCount > 99 ? "99+" : pendingCount)
                : null;
        const label =
          badge === "!"
            ? `${item.label} — couldn't reach the queue`
            : badge
              ? `${item.label} — ${badge} waiting`
              : item.label;
        return (
          <span key={item.slug} style={{ display: "contents" }}>
            {sep && <span className="lx-rail-sep" aria-hidden="true" />}
            <Link
              href={item.href}
              className="lx-rail-item"
              aria-current={active ? "page" : undefined}
              aria-label={label}
              title={label}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              {badge && <span className="lx-rail-badge">{badge}</span>}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
