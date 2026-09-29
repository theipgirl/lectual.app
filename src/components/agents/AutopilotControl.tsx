"use client";

import { useActionState } from "react";
import { setAutopilotAction, type AgentActionState } from "@/app/dashboard/agents/actions";

/**
 * Pause / Resume Autopilot. Drawn on Today (compact) and on the Agents page.
 * The button shown follows the caller's role (attorney and above may pause;
 * owner/admin/senior_admin may resume), and the action and the database check
 * the same thing again.
 */
export function AutopilotControl(props: {
  paused: boolean;
  stateLine: string;
  reason: string | null;
  canPause: boolean;
  canResume: boolean;
  compact?: boolean;
}) {
  const [state, act, pending] = useActionState<AgentActionState, FormData>(setAutopilotAction, {});
  const { paused, canPause, canResume, compact } = props;
  const canAct = paused ? canResume : canPause;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={`lx-pill ${paused ? "lx-pill-warn" : "lx-pill-ok"}`}>{paused ? "Paused" : "On"}</span>
        <span className="lx-note" style={{ flex: 1, minWidth: 160 }}>
          {props.stateLine}
        </span>
        {canAct && (
          <form action={act} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="paused" value={String(!paused)} />
            {!paused && !compact && (
              <input
                className="lx-input"
                name="reason"
                maxLength={280}
                placeholder="Why (optional)"
                aria-label="Why you are pausing (optional)"
                style={{ width: 180, height: 32 }}
              />
            )}
            <button type="submit" className={`lx-btn lx-btn-sm ${paused ? "lx-btn-pri" : "lx-btn-sec"}`} disabled={pending}>
              {pending ? "Saving…" : paused ? "Resume Autopilot" : "Pause Autopilot"}
            </button>
          </form>
        )}
      </div>
      {paused && props.reason && <span className="lx-note">“{props.reason}”</span>}
      {paused && !canResume && <span className="lx-note">An owner or admin can resume it.</span>}
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {state.error}
        </span>
      )}
      {state.ok && state.message && <span className="lx-note">{state.message}</span>}
    </div>
  );
}
