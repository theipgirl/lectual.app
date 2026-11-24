"use client";

import { useState, useTransition } from "react";
import { SAVING } from "@/lib/ui/words";
import "./notifications.css";
import { markAllNotificationsRead } from "@/app/dashboard/notifications/actions";

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      setError("error" in result ? result.error : null);
    });

  return (
    <>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={run} disabled={pending}>
        {pending ? SAVING : "Mark all read"}
      </button>
      {error && (
        <span role="alert" className="lx-note lx-notif-error">
          {error}
        </span>
      )}
    </>
  );
}
