import { describe, expect, it } from "vitest";
import { INTEGRATION_STATES, integrationPill, stateForStatus } from "@/components/integrations/states";

describe("the state-to-pill mapping", () => {
  it("covers all seven states, each with its own label text", () => {
    expect([...INTEGRATION_STATES]).toEqual(["connected", "not-connected", "reconnect", "needs-attention", "couldnt-check", "not-available", "coming-soon"]);
    const labels = INTEGRATION_STATES.map((s) => integrationPill(s).label);
    expect(labels).toEqual(["Connected", "Not connected", "Reconnect", "Needs attention", "Couldn't check", "Not available yet", "Coming soon"]);
    expect(new Set(labels).size).toBe(7);
  });

  it("gives every state a tone class from the shared pill set", () => {
    for (const s of INTEGRATION_STATES) expect(integrationPill(s).tone).toMatch(/^lx-pill-(ok|warn|risk|mute)$/);
  });

  it("maps a stored connection status to a state", () => {
    expect(stateForStatus("active")).toBe("connected");
    expect(stateForStatus("reauth")).toBe("reconnect");
    expect(stateForStatus("invalid")).toBe("reconnect");
    expect(stateForStatus("error")).toBe("needs-attention");
    expect(stateForStatus("revoked")).toBe("not-connected");
  });
});
