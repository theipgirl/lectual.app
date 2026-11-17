import { Pill } from "@/components/ui/Pill";
import { integrationPill, type IntegrationState } from "./states";
import "./integrations.css";

/** An integration's status: its own text label and tone for each state. */
export function StatusPill({ state }: { state: IntegrationState }) {
  const pill = integrationPill(state);
  return (
    <Pill tone={pill.tone} dataState={state}>
      {pill.label}
    </Pill>
  );
}

/** Live or test mode on a payment connection. A mode, not a status, so it sits beside the pill. */
export function ModeBadge({ live }: { live: boolean }) {
  return <Pill tone={live ? "ox" : "warn"}>{live ? "Live" : "Test"}</Pill>;
}
