"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveProfileAction, type ProfileState } from "@/app/dashboard/settings/firm/actions";
import { TEMPERATURE_NAME } from "@/lib/ui/words";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { SIGNOFF_PLACEHOLDER, firmFormDirty, firmFormValues, zoneOptions, type FirmFormValues } from "@/lib/org/firm-form";

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
  const formRef = useRef<HTMLFormElement>(null);
  const zones = zoneOptions(props.zones);
  const initial: FirmFormValues = {
    displayName: props.displayName ?? "",
    timeZone: props.timeZone,
    emailSignature: props.signature ?? "",
    strategySessionUrl: props.strategySessionUrl ?? "",
    discoveryCallUrl: props.discoveryCallUrl ?? "",
    nurtureSequenceId: props.nurtureSequenceId ?? "",
  };
  // What is saved, as far as this page knows: the values it loaded with, then whatever was last saved here.
  const [saved, setSaved] = useState<FirmFormValues>(initial);
  const [dirty, setDirty] = useState(false);
  const latest = useRef<FirmFormValues>(initial);

  const check = () => {
    if (!formRef.current) return;
    latest.current = firmFormValues(new FormData(formRef.current));
    setDirty(firmFormDirty(saved, latest.current));
  };

  useEffect(() => {
    if (state.saved && !pending) {
      setSaved(latest.current);
      setDirty(false);
    }
  }, [state, pending]);

  const discard = () => {
    formRef.current?.reset();
    setDirty(false);
  };

  return (
    <form ref={formRef} action={action} onChange={check} onInput={check} style={{ display: "grid", gap: 16 }}>
      <section className="lx-card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }} aria-labelledby="firm-details-h">
        <h2 id="firm-details-h" className="lx-h2" style={{ fontSize: 23, gridColumn: "1 / -1" }}>
          Firm details
        </h2>
        <label className="lx-field">
          <span className="lx-label">Firm name on drafts</span>
          <input className="lx-input" name="displayName" defaultValue={props.displayName ?? ""} placeholder={props.firmName} disabled={disabled} maxLength={120} />
        </label>
        <label className="lx-field">
          <span className="lx-label">Time zone</span>
          <select className="lx-input" name="timeZone" defaultValue={props.timeZone} disabled={disabled}>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
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
            placeholder={SIGNOFF_PLACEHOLDER}
          />
          <span className="lx-note">The assistants that draft end client emails with this. Every draft still waits in the approval queue.</span>
        </label>
      </section>

      <section className="lx-card" style={{ padding: 20, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }} aria-labelledby="firm-booking-h">
        <h2 id="firm-booking-h" className="lx-h2" style={{ fontSize: 23, gridColumn: "1 / -1" }}>
          Booking links and nurture
        </h2>
        <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {TEMPERATURE_NAME}{" "}decides the next step shown on a lead&apos;s page: Hot → a strategy session, Warm → a discovery call,
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
      </section>

      {props.canEdit ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </button>
          {state.saved && !pending && !dirty && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
          {state.error && <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>{state.error}</span>}
        </div>
      ) : (
        <p className="lx-note" style={{ margin: 0 }}>{ADMIN_TIER_PHRASE} can edit the firm profile.</p>
      )}

      {props.canEdit && dirty && (
        <div className="lx-unsaved" data-save-bar role="region" aria-label="Unsaved changes">
          <span style={{ flex: 1, minWidth: 0 }}>Unsaved changes</span>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={discard} disabled={pending}>
            Discard
          </button>
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}
