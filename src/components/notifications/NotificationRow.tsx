"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markNotificationRead } from "@/app/dashboard/notifications/actions";
import { NotificationIcon } from "./NotificationIcon";
import type { NotificationRowView } from "./view";

/**
 * One notification. With a link it navigates there; without one it is a button.
 * Either way, opening an unread one marks it read.
 */
export function NotificationRow({ item, onOpen }: { item: NotificationRowView; onOpen?: () => void }) {
  const [, startTransition] = useTransition();

  const open = () => {
    if (item.unread) startTransition(async () => void (await markNotificationRead(item.id)));
    onOpen?.();
  };

  const body = (
    <>
      <span className="lx-notif-icon">
        <NotificationIcon icon={item.icon} />
      </span>
      <span className="lx-notif-text">
        <span className="lx-label" style={{ fontSize: 11 }}>
          {item.label}
        </span>
        <span className="lx-notif-sentence">{item.sentence}</span>
      </span>
      <span className="lx-notif-meta">
        {item.unread && <span className="lx-notif-dot" role="img" aria-label="Unread" />}
        <span className="lx-note">{item.when}</span>
      </span>
    </>
  );

  return item.href ? (
    <Link href={item.href} className="lx-notif-row" data-unread={item.unread || undefined} onClick={open}>
      {body}
    </Link>
  ) : (
    <button type="button" className="lx-notif-row" data-unread={item.unread || undefined} onClick={open}>
      {body}
    </button>
  );
}
