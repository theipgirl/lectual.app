"use client";

import { useActionState } from "react";
import { saveMinutesPerTaskAction, type AgentActionState } from "@/app/dashboard/agents/actions";
import { AGENT_DEFS, AGENT_IDS, type AgentId } from "@/lib/agents/types";
import { DEFAULT_MINUTES_PER_TASK, MAX_MINUTES_PER_TASK, TASK_UNIT } from "@/lib/agents/autopilot-rules";

/** The firm's minutes-per-task estimate behind "Hours saved (est.)". Admins edit; everyone sees it. */
export function MinutesPerTaskForm(props: { minutes: Record<AgentId, number>; canManage: boolean }) {
  const [state, save, pending] = useActionState<AgentActionState, FormData>(saveMinutesPerTaskAction, {});
  return (
    <form action={save} style={{ display: "grid", gap: 10 }}>
      {AGENT_IDS.map((a) => (
        <label key={a} className="lx-field" style={{ display: "grid", gridTemplateColumns: "1fr 90px", alignItems: "center", gap: 10 }}>
          <span>
            <span style={{ fontWeight: 500 }}>{AGENT_DEFS[a].name}</span>
            <span className="lx-note" style={{ display: "block" }}>
              Minutes per {TASK_UNIT[a].singular} · default {DEFAULT_MINUTES_PER_TASK[a]}
            </span>
          </span>
          <input
            className="lx-input"
            type="number"
            min={0}
            max={MAX_MINUTES_PER_TASK}
            step="0.5"
            name={`minutes-${a}`}
            defaultValue={props.minutes[a]}
            disabled={!props.canManage || pending}
            aria-label={`Minutes per ${TASK_UNIT[a].singular}`}
          />
        </label>
      ))}
      {props.canManage && (
        <div>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Save estimate"}
          </button>
        </div>
      )}
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {state.error}
        </span>
      )}
      {state.ok && <span className="lx-note">Saved.</span>}
    </form>
  );
}
