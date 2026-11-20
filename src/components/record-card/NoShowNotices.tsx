"use client";

import { useSyncExternalStore } from "react";
import { Toast } from "@/components/ui/Toast";
import { NO_NOTICES, noShowNotices } from "@/components/record-card/no-show-notices";
import { RECORD_CARD_NO_SHOW_DISMISS, recordCardNoShowNotLogged } from "@/lib/ui/words";

/**
 * Mounted once in the dashboard layout, outside every card: when a card closes inside its no-show hold, nothing is written and
 * this says so ("No-show not logged ..."), newest first, until dismissed.
 */
export function NoShowNotices() {
  const notices = useSyncExternalStore(noShowNotices.subscribe, noShowNotices.list, () => NO_NOTICES);
  const newest = notices[notices.length - 1];
  if (!newest) return null;
  return (
    <Toast
      action={
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => noShowNotices.dismiss(newest.id)}>
          {RECORD_CARD_NO_SHOW_DISMISS}
        </button>
      }
    >
      <span>{recordCardNoShowNotLogged(newest.name)}</span>
    </Toast>
  );
}
