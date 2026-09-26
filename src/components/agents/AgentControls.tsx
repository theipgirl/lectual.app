"use client";

import { useActionState } from "react";
import {
  runAgentNowAction,
  saveAgentSettingAction,
  type AgentActionState,
} from "@/app/dashboard/agents/actions";
import { AUTONOMY_HINT, type AgentId, type Autonomy } from "@/lib/agents/types";

const LEVELS: { k: Autonomy; label: string }[] = [
  { k: "suggest", label: "Suggest" },
  { k: "draft", label: "Draft" },
  { k: "act", label: "Act" },
];

/** The switch, the autonomy segments and "Run now" on one agent card. */
export function AgentControls(props: {
  agent: AgentId;
  name: string;
  enabled: boolean;
  autonomy: Autonomy;
  canManage: boolean;
}) {
  const [saveState, save, saving] = useActionState<AgentActionState, FormData>(saveAgentSettingAction, {});
  const [runState, run, running] = useActionState<AgentActionState, FormData>(runAgentNowAction, {});
  const { agent, enabled, autonomy, canManage } = props;

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
              title={AUTONOMY_HINT[l.k]}
            >
              {l.label}
            </button>
          ))}
        </form>
        <div className="lx-note" style={{ marginTop: 6 }}>
          {AUTONOMY_HINT[autonomy]}
        </div>
        {saveState.error && (
          <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: "6px 0 0" }}>
            {saveState.error}
          </p>
        )}
      </div>

      <div className="lx-agent-slot-run">
        {canManage && (
          <form action={run}>
            <input type="hidden" name="agent" value={agent} />
            <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={!enabled || running}>
              {running ? "Running…" : "Run now"}
            </button>
          </form>
        )}
        {runState.error && (
          <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
            {runState.error}
          </span>
        )}
        {runState.ok && runState.message && <span className="lx-note">{runState.message}</span>}
      </div>
    </>
  );
}
