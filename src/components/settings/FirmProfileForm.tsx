"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileState } from "@/app/dashboard/settings/firm/actions";

export function FirmProfileForm(props: { firmName: string; displayName: string | null; timeZone: string; signature: string | null; zones: string[]; canEdit: boolean }) {
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
