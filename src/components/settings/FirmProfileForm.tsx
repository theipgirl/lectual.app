"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileState } from "@/app/dashboard/settings/firm/actions";

export function FirmProfileForm(props: {
  firmName: string;
  displayName: string | null;
  timeZone: string;
  signature: string | null;
  strategySessionUrl: string | null;
  discoveryCallUrl: string | null;
  nurtureSequenceId: string | null;
  campaigns: { id: string; name: string }[];
  campaignsFailed: boolean;
  zones: string[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfileAction, {});
  const disabled = !props.canEdit || pending;
  return (
    <form action={action} className="lx-card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
      <label className="lx-field">
        <span className="lx-label">Firm name on drafts</span>
        <input className="lx-input" name="displayName" defaultValue={props.displayName ?? ""} placeholder={props.firmName} disabled={disabled} maxLength={120} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Time zone</span>
        <select className="lx-input" name="timeZone" defaultValue={props.timeZone} disabled={disabled}>
          {props.zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Sign-off for client drafts</span>
        <textarea
          className="lx-input"
          name="emailSignature"
          rows={4}
          maxLength={2000}
          defaultValue={props.signature ?? ""}
          disabled={disabled}
          placeholder={`${props.firmName}\nThis message is not legal advice until you have signed an engagement letter.`}
        />
        <span className="lx-note">The drafting agents end client emails with this. Every draft still waits in the approval queue.</span>
      </label>
      <fieldset style={{ gridColumn: "1 / -1", border: "none", padding: 0, margin: 0, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <legend className="lx-label" style={{ marginBottom: 6 }}>
          Intake lanes — next steps
        </legend>
        <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
          A lead&apos;s lane decides the next step shown on its page: Hot → a strategy session, Warm → a discovery call,
          Cold → your nurture campaign. These are links and buttons for your team; nothing is sent to a client
          automatically.
        </p>
        <label className="lx-field">
          <span className="lx-label">Hot — strategy-session booking link</span>
          <input
            className="lx-input"
            name="strategySessionUrl"
            type="url"
            inputMode="url"
            defaultValue={props.strategySessionUrl ?? ""}
            placeholder="https://calendly.com/your-firm/strategy-session"
            disabled={disabled}
            maxLength={500}
          />
        </label>
        <label className="lx-field">
          <span className="lx-label">Warm — discovery-call booking link</span>
          <input
            className="lx-input"
            name="discoveryCallUrl"
            type="url"
            inputMode="url"
            defaultValue={props.discoveryCallUrl ?? ""}
            placeholder="https://calendly.com/your-firm/discovery"
            disabled={disabled}
            maxLength={500}
          />
        </label>
        <label className="lx-field">
          <span className="lx-label">Cold — nurture campaign</span>
          {props.campaignsFailed ? (
            <>
              <input type="hidden" name="nurtureSequenceId" value={props.nurtureSequenceId ?? ""} />
              <span className="lx-note" style={{ color: "var(--wine)" }}>
                Campaigns couldn&apos;t be loaded, so this stays as it is. Try again shortly.
              </span>
            </>
          ) : (
            <select className="lx-input" name="nurtureSequenceId" defaultValue={props.nurtureSequenceId ?? ""} disabled={disabled}>
              <option value="">{props.campaigns.length === 0 ? "No campaigns yet — create one in Campaigns" : "None chosen"}</option>
              {props.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </label>
      </fieldset>
      {props.canEdit ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
          {state.error && <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>{state.error}</span>}
        </div>
      ) : (
        <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>Owners, admins and senior admins edit the firm profile.</p>
      )}
    </form>
  );
}
