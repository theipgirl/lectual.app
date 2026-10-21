import { integrationPill, type IntegrationState } from "./states";
import "./integrations.css";

/** An integration's status: its own text label and tone for each state. */
export function StatusPill({ state }: { state: IntegrationState }) {
  const pill = integrationPill(state);
  return (
    <span className={`lx-pill ${pill.tone}`} data-state={state}>
      {pill.label}
    </span>
  );
}

/** Live or test mode on a payment connection. A mode, not a status, so it sits beside the pill. */
export function ModeBadge({ live }: { live: boolean }) {
  return <span className={`lx-pill ${live ? "lx-pill-ox" : "lx-pill-warn"}`}>{live ? "Live" : "Test"}</span>;
}
