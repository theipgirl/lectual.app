"use client";

import { useActionState } from "react";
import {
  addToNurtureAction,
  setLeadLaneAction,
  type LeadSequenceState,
} from "@/app/dashboard/leads/[id]/sequence-actions";
import { LANES, LANE_LABEL, suggestionLine, type LaneView, type NextStep } from "@/lib/leads/lane";
import { temperatureLabel, type EffectiveTemperature } from "@/lib/intake/effective-temperature";
import { LtnSuggestion } from "@/components/intake/LtnSuggestion";

/**
 * The lead page's ONE temperature card (intake SOP Stage 2), the twin of the
 * Intake table's Temperature column: the chip (a person's is solid, a derived
 * one is dashed and says "Suggested"), the reason, what the activity says now
 * when a person's lane has gone stale, the triage SUGGESTION labelled as one,
 * who set the lane and when, the control to set or clear it, the next step the
 * lane points at, and the Long-Term Nurture suggestion.
 *
 * Presentation only. The lane write and "Add to nurture" go through server
 * actions that re-check the role; the booking links are plain links a person
 * opens — nothing here sends anything to a client.
 */
export function TemperatureCard(props: {
  leadId: string;
  temperature: EffectiveTemperature;
  view: LaneView;
  setByName: string | null;
  setOn: string | null;
  redFlags: string[];
  nextStep: NextStep | null;
  /** True when the next step comes from the suggestion, not a person's lane. */
  nextStepIsSuggested: boolean;
  /** The nurture campaign's current enrollment status for this lead, if any. */
  nurtureStatus: string | null;
  linksFailed: boolean;
  canWrite: boolean;
}) {
  const { leadId, view, nextStep, temperature } = props;
  // The suggestion has its own line with a link, so the reason doesn't say it twice.
  const reason = temperature.suggestion ? temperature.reason.replace(/ · Long-Term Nurture suggested/, "") : temperature.reason;
  const person = temperature.source === "person" && temperature.value !== null;
  const [laneState, laneAction, lanePending] = useActionState<LeadSequenceState, FormData>(setLeadLaneAction, {});
  const [nurtureState, nurtureAction, nurturePending] = useActionState<LeadSequenceState, FormData>(addToNurtureAction, {});
  const suggestion = suggestionLine(view);

  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="temperature-heading">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="temperature-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
          Temperature
        </h2>
        <span
          className={`lx-pill ${temperature.value === "hot" ? "lx-pill-risk" : temperature.value === "warm" ? "lx-pill-warn" : "lx-pill-mute"}`}
          style={person ? undefined : { border: "1px dashed currentColor", background: "transparent", fontStyle: "italic" }}
        >
          {temperatureLabel(temperature)}
        </span>
        {person && (
          <span className="lx-note">
            set{props.setByName ? ` by ${props.setByName}` : " by a person"}
            {props.setOn ? ` · ${props.setOn}` : ""}
          </span>
        )}
      </div>

      <p className="lx-note" style={{ margin: 0 }}>
        {reason}
      </p>
      {temperature.activityHint && (
        <p className="lx-note" style={{ margin: 0 }}>
          {temperature.activityHint}
        </p>
      )}
      <LtnSuggestion suggestion={temperature.suggestion} leadId={leadId} target="sequences" />

      {suggestion ? (
        <div style={{ borderLeft: "3px dashed var(--line)", paddingLeft: 12 }}>
          <div className="lx-label" style={{ marginBottom: 4 }}>
            Triage suggestion — not a decision
          </div>
          <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55, fontStyle: "italic" }}>{suggestion}</p>
          {view.lane && view.suggested && view.lane !== view.suggested && (
            <p className="lx-note" style={{ margin: "4px 0 0" }}>
              Overridden: the temperature above was set by a person and wins.
            </p>
          )}
          {props.redFlags.length > 0 && (
            <ul className="lx-flags">
              {props.redFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="lx-note" style={{ margin: 0 }}>
          No triage suggestion for this lead.
        </p>
      )}

      {props.canWrite && (
        <form action={laneAction} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="leadId" value={leadId} />
          <label className="lx-field" style={{ minWidth: 180 }}>
            <span className="lx-label">Set the temperature</span>
            <select className="lx-input" name="lane" defaultValue={view.lane ?? ""} aria-label="Set the temperature">
              <option value="">Clear (not set)</option>
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {LANE_LABEL[l]}
                  {view.suggested === l ? " (suggested)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={lanePending}>
            {lanePending ? "Saving…" : "Save temperature"}
          </button>
          {laneState.error && (
            <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
              {laneState.error}
            </span>
          )}
          {laneState.message && !laneState.error && (
            <span role="status" className="lx-note" style={{ color: "var(--ok)" }}>
              {laneState.message}
            </span>
          )}
        </form>
      )}

      {nextStep && (
        <div className="lx-card" style={{ padding: 14, display: "grid", gap: 8, background: "var(--surface2, transparent)" }}>
          <div className="lx-label">{props.nextStepIsSuggested ? "Suggested next step (from triage — set the temperature to confirm)" : "Next step"}</div>
          {nextStep.kind === "nurture" ? (
            props.nurtureStatus ? (
              <p className="lx-note" style={{ margin: 0 }}>
                Already in the nurture campaign ({props.nurtureStatus.toLowerCase()}).
              </p>
            ) : nextStep.sequenceId ? (
              props.canWrite ? (
                <form action={nurtureAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="hidden" name="leadId" value={leadId} />
                  <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={nurturePending}>
                    {nurturePending ? "Adding…" : nextStep.label}
                  </button>
                  <span className="lx-note">Enrolls them in the firm&apos;s nurture campaign. Its emails draft into the approval queue.</span>
                  {nurtureState.error && (
                    <span role="alert" className="lx-note" style={{ color: "var(--wine)", flexBasis: "100%" }}>
                      {nurtureState.error}
                    </span>
                  )}
                  {nurtureState.message && !nurtureState.error && (
                    <span role="status" className="lx-note" style={{ color: "var(--ok)", flexBasis: "100%" }}>
                      {nurtureState.message}
                    </span>
                  )}
                </form>
              ) : (
                <p className="lx-note" style={{ margin: 0 }}>{nextStep.label}</p>
              )
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>
                {nextStep.label} — {props.linksFailed ? "the firm's settings couldn't be loaded." : nextStep.missing}
              </p>
            )
          ) : nextStep.url ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <a href={nextStep.url} target="_blank" rel="noopener noreferrer" className="lx-btn lx-btn-pri lx-btn-sm">
                {nextStep.label} ↗
              </a>
              <span className="lx-note" style={{ wordBreak: "break-all" }}>
                {nextStep.url}
              </span>
              <span className="lx-note" style={{ flexBasis: "100%" }}>
                Opens the firm&apos;s booking page. Book it with the client, or put the link in a reply — any email still goes
                through the approval queue.
              </span>
            </div>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>
              {nextStep.label} — {props.linksFailed ? "the firm's settings couldn't be loaded." : nextStep.missing}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
