"use client";

import { useActionState } from "react";
import {
  runAgentNowAction,
  saveAgentSettingAction,
  type AgentActionState,
} from "@/app/dashboard/agents/actions";
import { autonomyHint, type AgentId, type Autonomy } from "@/lib/agents/types";
import { decideRunNow, runResultLine, RUN_NOW_NO_ANSWER, type RunNowInput } from "@/lib/agents/run-now";

const LEVELS: { k: Autonomy; label: string }[] = [
  { k: "suggest", label: "Suggest" },
  { k: "draft", label: "Draft" },
  { k: "act", label: "Act" },
];

/**
 * Run now, with a failed request turned into a line on the card. Without this a request that never
 * answers (a network drop, a function stopped at its limit) would throw into the page's error boundary
 * or leave the button looking idle with nothing said.
 */
export async function runNowOrSay(prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  try {
    return await runAgentNowAction(prev, formData);
  } catch {
    return { error: RUN_NOW_NO_ANSWER };
  }
}

/**
 * The switch, the autonomy segments and "Run now" on one agent card. Run now is always drawn: when it
 * can't run it is disabled and says why, in text, from the same decision the action makes.
 */
export function AgentControls(props: {
  agent: AgentId;
  name: string;
  enabled: boolean;
  autonomy: Autonomy;
  canManage: boolean;
  /** What decideRunNow needs, minus "running", which only this card knows. */
  runInput: Omit<RunNowInput, "running">;
}) {
  const [saveState, save, saving] = useActionState<AgentActionState, FormData>(saveAgentSettingAction, {});
  const [runState, run, running] = useActionState<AgentActionState, FormData>(runNowOrSay, {});
  const { agent, enabled, autonomy, canManage } = props;
  const decision = decideRunNow({ ...props.runInput, running });
  const result = runResultLine(runState);
  const reasonId = `run-reason-${agent}`;

  return (
    <>
      <form action={save} className="lx-agent-toggle">
        <input type="hidden" name="agent" value={agent} />
        <input type="hidden" name="autonomy" value={autonomy} />
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <button
          type="submit"
          role="switch"
          aria-checked={enabled}
          aria-label={`Turn ${props.name} ${enabled ? "off" : "on"}`}
          className={`lx-toggle${enabled ? " on" : ""}`}
          disabled={!canManage || saving}
        >
          <i />
        </button>
      </form>

      <div className="lx-agent-slot-autonomy">
        <div className="lx-label" style={{ fontSize: 11, marginBottom: 6 }}>
          Autonomy
        </div>
        <form action={save} className="lx-lv">
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="enabled" value={String(enabled)} />
          {LEVELS.map((l) => (
            <button
              key={l.k}
              type="submit"
              name="autonomy"
              value={l.k}
              aria-pressed={autonomy === l.k}
              className={autonomy === l.k ? "on" : undefined}
              disabled={!canManage || !enabled || saving}
              title={autonomyHint(agent, l.k)}
            >
              {l.label}
            </button>
          ))}
        </form>
        <div className="lx-note" style={{ marginTop: 6 }}>
          {autonomyHint(agent, autonomy)}
        </div>
        {saveState.error && (
          <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: "6px 0 0" }}>
            {saveState.error}
          </p>
        )}
      </div>

      <div className="lx-agent-slot-run">
        <form action={run}>
          <input type="hidden" name="agent" value={agent} />
          <button
            type="submit"
            className="lx-btn lx-btn-ghost lx-btn-sm"
            disabled={!decision.canRun}
            aria-describedby={decision.canRun ? undefined : reasonId}
          >
            {running ? "Running..." : "Run now"}
          </button>
        </form>
      </div>
      {(!decision.canRun || result) && (
        <div style={{ gridColumn: "1 / -1", display: "grid", gap: 4 }}>
          {!decision.canRun && (
            <p id={reasonId} className="lx-note" style={{ margin: 0, ...(decision.tone === "warn" ? { color: "var(--warn)" } : {}) }}>
              {decision.reason}
            </p>
          )}
          {result && (
            <p
              role={result.alert ? "alert" : "status"}
              className="lx-note"
              style={{ margin: 0, ...(result.alert ? { color: "var(--wine)" } : {}) }}
            >
              {result.text}
            </p>
          )}
        </div>
      )}
    </>
  );
}
