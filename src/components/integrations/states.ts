/**
 * The seven states an integration card can be in, each with its own words.
 * The label carries the meaning; the tone is only a second signal, so colour
 * is never the only thing telling a person what state a service is in.
 */
export const INTEGRATION_STATES = [
  "connected",
  "not-connected",
  "reconnect",
  "needs-attention",
  "couldnt-check",
  "not-available",
  "coming-soon",
] as const;

export type IntegrationState = (typeof INTEGRATION_STATES)[number];

export type PillSpec = { label: string; tone: string };

const PILLS: Record<IntegrationState, PillSpec> = {
  connected: { label: "Connected", tone: "lx-pill-ok" },
  "not-connected": { label: "Not connected", tone: "lx-pill-mute" },
  reconnect: { label: "Reconnect", tone: "lx-pill-risk" },
  "needs-attention": { label: "Needs attention", tone: "lx-pill-warn" },
  "couldnt-check": { label: "Couldn't check", tone: "lx-pill-warn" },
  "not-available": { label: "Not available yet", tone: "lx-pill-mute" },
  "coming-soon": { label: "Coming soon", tone: "lx-pill-mute" },
};

/** The pill for a state: its own label and tone. */
export function integrationPill(state: IntegrationState): PillSpec {
  return PILLS[state];
}

/** A stored connection's status as a state: an active one is connected, a rejected one needs reconnecting. */
export function stateForStatus(status: string): IntegrationState {
  if (status === "active") return "connected";
  if (status === "error") return "needs-attention";
  if (status === "revoked") return "not-connected";
  return "reconnect";
}
