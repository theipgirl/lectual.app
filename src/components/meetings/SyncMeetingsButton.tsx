"use client";

import Link from "next/link";
import { useActionState } from "react";
import { syncNewMeetingsAction, type SyncMeetingsState } from "@/app/dashboard/meetings/sync-action";
import type { SyncSummary } from "@/lib/meetings/sync-result";
import type { SyncControl } from "@/lib/meetings/sync-access";

const MEETINGS_SETUP = "/dashboard/settings/integrations/meetings/";
export const SYNC_LABEL = "Sync new meetings";

/** The result line: an alert only for an error, a quiet status otherwise. */
export function SyncResult({ summary }: { summary: SyncSummary }) {
  return (
    <p role={summary.tone === "error" ? "alert" : "status"} className="lx-note lx-sync-result" style={{ margin: 0, color: summary.tone === "error" ? "var(--wine)" : "var(--ok)" }}>
      {summary.text}
      {summary.reconnect && (
        <>
          {" "}
          <Link href={MEETINGS_SETUP}>Reconnect</Link>
        </>
      )}
    </p>
  );
}

export function SyncMeetingsButton() {
  const [state, action, pending] = useActionState<SyncMeetingsState, FormData>(syncNewMeetingsAction, {});
  return (
    <form action={action} className="lx-sync">
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Syncing…" : SYNC_LABEL}
      </button>
      {state.summary && <SyncResult summary={state.summary} />}
    </form>
  );
}

/** What the page draws for `syncControl`'s answer: nothing, a link to connect a source, or the button. */
export function SyncMeetingsControl({ control }: { control: SyncControl }) {
  if (control === "none") return null;
  if (control === "connect") {
    return (
      <Link href={MEETINGS_SETUP} className="lx-btn lx-btn-sec lx-btn-sm">
        Connect a meeting source
      </Link>
    );
  }
  return <SyncMeetingsButton />;
}
