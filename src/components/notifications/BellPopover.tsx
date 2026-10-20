"use client";

import Link from "next/link";
import { useRef } from "react";
import { MarkAllReadButton } from "./MarkAllReadButton";
import { NotificationRow } from "./NotificationRow";
import type { NotificationRowView } from "./view";

export type BellCount = { status: "ok"; unread: number } | { status: "unavailable" };
export type BellList = { status: "ok"; rows: NotificationRowView[] } | { status: "unavailable" };

/** The badge text: the count, "9+" past nine. */
export function badgeText(unread: number): string {
  return unread > 9 ? "9+" : String(unread);
}

function triggerLabel(count: BellCount): string {
  if (count.status === "unavailable") return "Notifications (couldn't load)";
  return count.unread > 0 ? `Notifications, ${count.unread} unread` : "Notifications";
}

function Panel({ count, list, close }: { count: BellCount; list: BellList; close: () => void }) {
  if (list.status === "unavailable") {
    return (
      <p role="alert" className="lx-note" style={{ margin: 0, padding: "14px 16px" }}>
        Couldn&apos;t load your notifications. This isn&apos;t the same as having none. Try refreshing in a moment.
      </p>
    );
  }
  if (list.rows.length === 0) {
    return count.status === "ok" ? (
      <p className="lx-note" style={{ margin: 0, padding: "14px 16px" }}>
        You&apos;re all caught up
      </p>
    ) : (
      <p className="lx-note" style={{ margin: 0, padding: "14px 16px" }}>
        Nothing to show, but the unread count couldn&apos;t be loaded.
      </p>
    );
  }
  return (
    <ul className="lx-notif-list">
      {list.rows.map((item) => (
        <li key={item.id}>
          <NotificationRow item={item} onOpen={close} />
        </li>
      ))}
    </ul>
  );
}

/** The bell in the top bar: a count badge and a panel of the newest ten. Rows come from the server as plain strings. */
export function BellPopover({ count, list }: { count: BellCount; list: BellList }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => menu.current?.removeAttribute("open");

  const anyUnread =
    (count.status === "ok" && count.unread > 0) || (list.status === "ok" && list.rows.some((row) => row.unread));

  return (
    <details ref={menu} className="lx-bell">
      <summary aria-label={triggerLabel(count)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 9a2 2 0 0 0 4 0" />
        </svg>
        {count.status === "unavailable" ? (
          <span className="lx-bell-badge lx-bell-badge-warn" title="Couldn't load notifications">
            !
          </span>
        ) : (
          count.unread > 0 && <span className="lx-bell-badge">{badgeText(count.unread)}</span>
        )}
      </summary>
      <div className="lx-card lx-bell-panel">
        <div className="lx-bell-head">
          <span className="lx-label" style={{ fontSize: 11 }}>
            Notifications
          </span>
          {anyUnread && <MarkAllReadButton />}
        </div>
        <Panel count={count} list={list} close={close} />
        <div className="lx-bell-foot">
          <Link href="/dashboard/notifications/" onClick={close}>
            See all notifications
          </Link>
          <span className="lx-note">Inside Lectual only. Never sent to a client.</span>
        </div>
      </div>
    </details>
  );
}
