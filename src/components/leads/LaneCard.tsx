"use client";

import { useActionState } from "react";
import {
  addToNurtureAction,
  setLeadLaneAction,
  type LeadSequenceState,
} from "@/app/dashboard/leads/[id]/sequence-actions";
import { LANES, LANE_LABEL, suggestionLine, type LaneView, type NextStep } from "@/lib/leads/lane";

/**
 * The lead page's lane card (intake SOP Stage 2): the triage SUGGESTION with
 * its reason, labelled as one; the lane a person set, with who and when; the
 * control to set it; and the next step the lane points at.
 *
 * Presentation only. The lane write and "Add to nurture" go through server
 * actions that re-check the role; the booking links are plain links a person
 * opens — nothing here sends anything to a client.
 */
export function LaneCard(props: {
  leadId: string;
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
  const { leadId, view, nextStep } = props;
  const [laneState, laneAction, lanePending] = useActionState<LeadSequenceState, FormData>(setLeadLaneAction, {});
  const [nurtureState, nurtureAction, nurturePending] = useActionState<LeadSequenceState, FormData>(addToNurtureAction, {});
  const suggestion = suggestionLine(view);

  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="lane-heading">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="lane-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
          Lane
        </h2>
        {view.lane ? (
          <span className={`lx-pill ${view.lane === "hot" ? "lx-pill-risk" : view.lane === "warm" ? "lx-pill-warn" : "lx-pill-mute"}`}>
            {LANE_LABEL[view.lane]}
          </span>
        ) : (
          <span className="lx-note">Not set by anyone yet</span>
        )}
        {view.lane && (
          <span className="lx-note">
            set{props.setByName ? ` by ${props.setByName}` : ""}
            {props.setOn ? ` · ${props.setOn}` : ""}
          </span>
        )}
      </div>

      {suggestion ? (
        <div style={{ borderLeft: "3px dashed var(--line)", paddingLeft: 12 }}>
          <div className="lx-label" style={{ marginBottom: 4 }}>
            Triage suggestion — not a decision
          </div>
          <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55, fontStyle: "italic" }}>{suggestion}</p>
          {view.lane && view.suggested && view.lane !== view.suggested && (
            <p className="lx-note" style={{ margin: "4px 0 0" }}>
              Overridden: the lane above was set by a person and wins.
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
            <span className="lx-label">Set the lane</span>
            <select className="lx-input" name="lane" defaultValue={view.lane ?? ""} aria-label="Lane">
              <option value="">No lane</option>
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {LANE_LABEL[l]}
                  {view.suggested === l ? " (suggested)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={lanePending}>
            {lanePending ? "Saving…" : "Save lane"}
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
          <div className="lx-label">{props.nextStepIsSuggested ? "Suggested next step (from triage — set the lane to confirm)" : "Next step"}</div>
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
