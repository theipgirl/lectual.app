"use client";

import { useActionState } from "react";
import { draftFollowUpAction, linkMeetingAction, type ActionState } from "@/app/dashboard/meetings/actions";
import {
  connectFathomAction,
  disconnectMeetingSourceAction,
  importNowAction,
  type MeetingsSettingsState,
} from "@/app/dashboard/settings/integrations/meetings/actions";

function Result({ state }: { state: ActionState | MeetingsSettingsState }) {
  if (state.error) {
    return (
      <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="lx-note" style={{ margin: 0, color: "var(--ok)" }}>
        {state.notice}
      </p>
    );
  }
  return null;
}

type Option = { id: string; label: string };

/** Link (or unlink) a meeting to one lead and/or one matter of this firm. */
export function LinkMeetingForm(props: {
  meetingId: string;
  leadId: string | null;
  matterId: string | null;
  leads: Option[];
  matters: Option[];
  suggestedLeadId: string | null;
  suggestedMatterId: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(linkMeetingAction, {});
  const leadDefault = props.leadId ?? props.suggestedLeadId ?? "";
  const matterDefault = props.matterId ?? props.suggestedMatterId ?? "";
  const linked = Boolean(props.leadId || props.matterId);
  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="meetingId" value={props.meetingId} />
      <label className="lx-field">
        <span className="lx-label">Lead</span>
        <select className="lx-input" name="leadId" defaultValue={leadDefault}>
          <option value="">— None —</option>
          {props.leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
              {l.id === props.suggestedLeadId && !props.leadId ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Matter</span>
        <select className="lx-input" name="matterId" defaultValue={matterDefault}>
          <option value="">— None —</option>
          {props.matters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.id === props.suggestedMatterId && !props.matterId ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : linked ? "Save link" : "Link"}
        </button>
        {linked && (
          <button
            type="submit"
            className="lx-btn lx-btn-ghost lx-btn-sm"
            disabled={pending}
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (!form) return;
              (form.elements.namedItem("leadId") as HTMLSelectElement).value = "";
              (form.elements.namedItem("matterId") as HTMLSelectElement).value = "";
            }}
          >
            Unlink
          </button>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

/** Puts a follow-up draft in the approval queue. Never sends. */
export function DraftFollowUpButton({ meetingId }: { meetingId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(draftFollowUpAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="meetingId" value={meetingId} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending || state.ok}>
        {pending ? "Drafting…" : state.ok ? "Drafted" : "Draft follow-up"}
      </button>
      <p className="lx-note" style={{ margin: 0 }}>
        Written from this meeting into the approval queue. Nothing is sent until an attorney edits and approves it.
      </p>
      <Result state={state} />
    </form>
  );
}

export function ConnectFathomForm({ reconnect }: { reconnect: boolean }) {
  const [state, action, pending] = useActionState<MeetingsSettingsState, FormData>(connectFathomAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <label className="lx-field">
        <span className="lx-label">Fathom API key</span>
        <input className="lx-input" name="key" type="password" autoComplete="off" spellCheck={false} placeholder="Paste the key from Fathom → Settings → API Access" required />
      </label>
      <p className="lx-note" style={{ margin: 0 }}>
        We check the key with one read-only request, then store it encrypted. Nobody at your firm can see it again. Lectual only reads from Fathom.
      </p>
      <div>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Checking…" : reconnect ? "Replace key" : "Connect Fathom"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ImportNowButton({ provider }: { provider: "fathom" | "zoom" }) {
  const [state, action, pending] = useActionState<MeetingsSettingsState, FormData>(importNowAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 6 }}>
      <input type="hidden" name="provider" value={provider} />
      <div>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Importing…" : "Import recent meetings"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function DisconnectSourceButton({ provider, label }: { provider: "fathom" | "zoom"; label: string }) {
  const [state, action, pending] = useActionState<MeetingsSettingsState, FormData>(disconnectMeetingSourceAction, {});
  return (
    <form
      action={action}
      className="lx-inline-form"
      onSubmit={(e) => {
        if (!confirm(`Disconnect ${label}? The stored credential is deleted. Meetings already imported stay.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="provider" value={provider} />
      <button type="submit" className="lx-btn lx-btn-danger lx-btn-sm" disabled={pending}>
        {pending ? "…" : "Disconnect"}
      </button>
      <Result state={state} />
    </form>
  );
}
