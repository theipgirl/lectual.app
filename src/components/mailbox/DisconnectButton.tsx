"use client";

import { useActionState, useRef } from "react";
import {
  disconnectMailboxAction,
  type DisconnectState,
} from "@/app/dashboard/settings/mailboxes/actions";

/** "Disconnect" with the design's confirm dialog in front of it. */
export function DisconnectButton({ id, email }: { id: string; email: string }) {
  const [state, action, pending] = useActionState<DisconnectState, FormData>(
    disconnectMailboxAction,
    {},
  );
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => dialog.current?.showModal()}>
        Disconnect
      </button>
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {state.error}
        </span>
      )}
      <dialog ref={dialog} className="lx-dialog" aria-labelledby={`dc-${id}`}>
        <form action={action} onSubmit={() => dialog.current?.close()}>
          <input type="hidden" name="id" value={id} />
          <div style={{ padding: 22, display: "grid", gap: 10 }}>
            <h2 id={`dc-${id}`} className="lx-h2" style={{ fontSize: 25 }}>
              Disconnect {email}?
            </h2>
            <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55 }}>
              Lectual stops reading this mailbox and deletes its stored access. Timeline entries
              already matched to clients stay on their records.
            </p>
          </div>
          <div className="lx-dialog-foot">
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => dialog.current?.close()}>
              Keep it
            </button>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
