"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { draftFollowUpAction, draftProposalAction, linkMeetingAction, type ActionState } from "@/app/dashboard/meetings/actions";
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

/**
 * Link (or unlink) a meeting to one lead and/or one matter of this firm.
 *
 * Three looks, one form. Linked: the text "Linked to <lead> · <matter>" (each a link) and a Change button; the
 * selects stay hidden until Change, and the submit then reads "Update link". Unlinked with a suggestion: "Suggested:
 * <name> · Link" (one button that files it) and "Choose another". Unlinked with nothing suggested: the selects and "Link".
 * After a saved change the form folds back to the linked text. Unlink stays a button of its own. A person is always
 * named by what the server read (`*Label`), never by an id.
 */
export function LinkMeetingForm(props: {
  meetingId: string;
  leadId: string | null;
  matterId: string | null;
  leads: Option[];
  matters: Option[];
  suggestedLeadId: string | null;
  suggestedMatterId: string | null;
  leadLabel?: string | null;
  matterLabel?: string | null;
  suggestedLeadLabel?: string | null;
  suggestedMatterLabel?: string | null;
  /** A sentence under the linked text ("Filed automatically from an attendee's email."). */
  note?: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(linkMeetingAction, {});
  const [choosing, setChoosing] = useState(false);
  // A saved change folds the form back to its text; the page's own data (props) is what it then reads.
  // Adjusted while rendering, when the action returns a new state, rather than in an effect.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setChoosing(false);
  }

  const linked = Boolean(props.leadId || props.matterId);
  const hasSuggestion = !linked && Boolean(props.suggestedLeadId || props.suggestedMatterId);
  const showSelects = choosing || (!linked && !hasSuggestion);
  const leadDefault = props.leadId ?? props.suggestedLeadId ?? "";
  const matterDefault = props.matterId ?? props.suggestedMatterId ?? "";
  const suggestedText = [props.suggestedLeadLabel, props.suggestedMatterLabel].filter(Boolean).join(" · ") || "a client of this firm";

  function clearLinks(form: HTMLFormElement | null) {
    if (!form) return;
    for (const name of ["leadId", "matterId"]) {
      const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (field) field.value = "";
    }
  }

  return (
    <form action={action} style={{ display: "grid", gap: 10 }} data-link-form={linked ? "linked" : hasSuggestion ? "suggested" : "unlinked"}>
      <input type="hidden" name="meetingId" value={props.meetingId} />

      {linked && (
        <p style={{ margin: 0 }} data-linked-text>
          {"Linked to "}
          {props.leadId && <Link href={`/dashboard/leads/${props.leadId}/`}>{props.leadLabel ?? "Lead"}</Link>}
          {props.leadId && props.matterId && " · "}
          {props.matterId && <Link href={`/dashboard/matters/${props.matterId}/`}>{props.matterLabel ?? "Matter"}</Link>}
        </p>
      )}
      {linked && props.note && (
        <p className="lx-note" style={{ margin: 0 }}>
          {props.note}
        </p>
      )}
      {hasSuggestion && !choosing && (
        <p className="lx-note" style={{ margin: 0 }}>
          More than one client shares an attendee&apos;s email, so this meeting was not filed on its own.
        </p>
      )}

      {showSelects ? (
        <>
          <label className="lx-field">
            <span className="lx-label">Lead</span>
            <select className="lx-input" name="leadId" defaultValue={leadDefault}>
              <option value="">— None —</option>
              {props.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
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
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="leadId" value={props.leadId ?? props.suggestedLeadId ?? ""} />
          <input type="hidden" name="matterId" value={props.matterId ?? props.suggestedMatterId ?? ""} />
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {hasSuggestion && !showSelects && (
          <span data-suggested-text>
            {"Suggested: "}
            {suggestedText}
            {" · "}
          </span>
        )}
        {showSelects ? (
          <>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              {pending ? "Saving…" : linked ? "Update link" : "Link"}
            </button>
            {choosing && (
              <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} onClick={() => setChoosing(false)}>
                Cancel
              </button>
            )}
          </>
        ) : linked ? (
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => setChoosing(true)}>
            Change
          </button>
        ) : (
          <>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              {pending ? "Saving…" : "Link"}
            </button>
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setChoosing(true)}>
              Choose another
            </button>
          </>
        )}
        {linked && (
          <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} onClick={(e) => clearLinks(e.currentTarget.form)}>
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

/** Drafts a proposal (for a named approver) and its email (for the approval queue) from this call. Never sends. */
export function DraftProposalButton({ meetingId }: { meetingId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(draftProposalAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="meetingId" value={meetingId} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending || state.ok}>
        {pending ? "Drafting…" : state.ok ? "Drafted" : "Draft proposal + email"}
      </button>
      <p className="lx-note" style={{ margin: 0 }}>
        Reads the call and drafts the client proposal from what was recommended, plus the email with its link. The proposal needs a named approver, then the email waits in the approval queue. Nothing is sent.
      </p>
      <Result state={state} />
      {state.ok && state.href && (
        <p className="lx-note" style={{ margin: 0 }}>
          <Link href={state.href}>Open the proposal</Link>
        </p>
      )}
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
