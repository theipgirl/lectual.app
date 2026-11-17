/**
 * The seven states an integration card can be in, each with its own words.
 * The label carries the meaning; the tone is only a second signal, so colour
 * is never the only thing telling a person what state a service is in.
 */
import type { PillTone } from "@/lib/ui/tones";

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

export type PillSpec = { label: string; tone: PillTone };

const PILLS: Record<IntegrationState, PillSpec> = {
  connected: { label: "Connected", tone: "ok" },
  "not-connected": { label: "Not connected", tone: "mute" },
  reconnect: { label: "Reconnect", tone: "risk" },
  "needs-attention": { label: "Needs attention", tone: "warn" },
  "couldnt-check": { label: "Couldn't check", tone: "warn" },
  "not-available": { label: "Not available yet", tone: "mute" },
  "coming-soon": { label: "Coming soon", tone: "mute" },
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
