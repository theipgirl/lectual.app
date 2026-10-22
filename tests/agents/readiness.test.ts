import { describe, it, expect } from "vitest";
import { agentReadiness, type AgentReadinessInput } from "@/lib/agents/readiness";

const base: AgentReadinessInput = {
  agent: "email-intel",
  enabled: true,
  hasMailboxModule: true,
  mailbox: "ok",
  aiConfigured: true,
  queue: "ok",
};
const r = (over: Partial<AgentReadinessInput>) => agentReadiness({ ...base, ...over });

describe("agentReadiness (S1)", () => {
  it("email-intel on with no active mailbox is waiting for one, as a warning", () => {
    const out = r({ mailbox: "none" });
    expect(out.label).toBe("On · waiting for a mailbox");
    expect(out.tone).toBe("warn");
  });

  it("an unreadable mailbox list is never just 'On'", () => {
    const out = r({ mailbox: "unavailable" });
    expect(out.label).toContain("couldn't check");
    expect(out.label).not.toBe("On");
    expect(out.tone).toBe("warn");
  });

  it("email-intel without the Mailboxes module needs it, on or off", () => {
    expect(r({ hasMailboxModule: false })).toMatchObject({ label: "Needs the Mailboxes module", tone: "warn" });
    expect(r({ hasMailboxModule: false, enabled: false })).toMatchObject({ label: "Needs the Mailboxes module", tone: "mute" });
  });

  it("email-intel with a connected mailbox and the AI key is ok", () => {
    expect(r({})).toMatchObject({ label: "On", tone: "ok" });
  });

  it("intake triage without the AI key is not ok", () => {
    const out = r({ agent: "intake-triage", aiConfigured: false });
    expect(out.tone).not.toBe("ok");
    expect(out.label).toBe("On · needs the AI key");
  });

  it("intake triage depends on neither the mailbox nor the queue", () => {
    expect(r({ agent: "intake-triage", hasMailboxModule: false, mailbox: "none", queue: "unavailable" })).toMatchObject({ label: "On", tone: "ok" });
  });

  it("post-consult with no queue is not ok, and an unreachable queue reads differently", () => {
    const none = r({ agent: "post-consult", queue: "none" });
    const down = r({ agent: "post-consult", queue: "unavailable" });
    expect(none.tone).toBe("warn");
    expect(down.tone).toBe("warn");
    expect(none.label).toBe("On · needs an approval queue");
    expect(down.label).toBe("On · couldn't reach the queue");
    expect(down.label).not.toBe(none.label);
  });

  it("post-consult ignores the mailbox", () => {
    expect(r({ agent: "post-consult", hasMailboxModule: false, mailbox: "none" })).toMatchObject({ label: "On", tone: "ok" });
  });

  it("any agent that is off, with its prerequisites met, is Off and muted", () => {
    for (const agent of ["email-intel", "intake-triage", "post-consult"] as const) {
      expect(r({ agent, enabled: false })).toMatchObject({ label: "Off", tone: "mute" });
    }
  });

  it("an off agent is Off even with the AI key missing (it isn't running to be blocked)", () => {
    expect(r({ enabled: false, aiConfigured: false })).toMatchObject({ label: "Off", tone: "mute" });
  });

  it("every non-ok result carries a reason", () => {
    const cases: Partial<AgentReadinessInput>[] = [
      { mailbox: "none" },
      { mailbox: "unavailable" },
      { hasMailboxModule: false },
      { aiConfigured: false },
      { agent: "post-consult", queue: "none" },
      { agent: "post-consult", queue: "unavailable" },
      { enabled: false },
    ];
    for (const c of cases) expect(r(c).reason.trim().length).toBeGreaterThan(10);
  });

  it("precedence: a missing module beats a missing AI key, which beats a missing mailbox", () => {
    expect(r({ hasMailboxModule: false, aiConfigured: false, mailbox: "none" }).label).toBe("Needs the Mailboxes module");
    expect(r({ aiConfigured: false, mailbox: "none" }).label).toBe("On · needs the AI key");
    expect(r({ mailbox: "none" }).label).toBe("On · waiting for a mailbox");
  });

  it("is pure: the same input gives the same answer", () => {
    expect(r({ mailbox: "none" })).toEqual(r({ mailbox: "none" }));
  });
});

describe("agentReadiness: the Stage Keeper (Sprint 16, F16)", () => {
  const sk = (over: Partial<AgentReadinessInput> = {}) => agentReadiness({ ...base, agent: "stage-keeper", ...over });

  it("needs no AI key: it is rule-based, so a missing key never blocks it", () => {
    expect(sk({ aiConfigured: false })).toMatchObject({ label: "On", tone: "ok" });
    expect(sk({ aiConfigured: false, calendar: "ok" })).toMatchObject({ label: "On", tone: "ok" });
  });

  it("is ready with an active mailbox, or with readable consults and no mailbox", () => {
    expect(sk({ mailbox: "ok", calendar: "none" })).toMatchObject({ tone: "ok" });
    expect(sk({ mailbox: "none", calendar: "ok" })).toMatchObject({ tone: "ok" });
    expect(sk({ mailbox: "unavailable", calendar: "ok" })).toMatchObject({ tone: "ok" });
  });

  it("is blocked, with a clear label, when there is no mailbox and no readable consult", () => {
    expect(sk({ mailbox: "none", calendar: "none" })).toMatchObject({ label: "On · waiting for a mailbox", tone: "warn" });
    expect(sk({ mailbox: "none" })).toMatchObject({ label: "On · waiting for a mailbox", tone: "warn" });
  });

  it("a failed read of either source is 'couldn't check', never 'nothing connected'", () => {
    expect(sk({ mailbox: "unavailable", calendar: "none" }).label).toContain("couldn't check");
    expect(sk({ mailbox: "none", calendar: "unavailable" }).label).toContain("couldn't check");
    expect(sk({ mailbox: "unavailable", calendar: "unavailable" }).tone).toBe("warn");
  });

  it("needs the Mailboxes module, on or off", () => {
    expect(sk({ hasMailboxModule: false })).toMatchObject({ label: "Needs the Mailboxes module", tone: "warn" });
    expect(sk({ hasMailboxModule: false, enabled: false })).toMatchObject({ label: "Needs the Mailboxes module", tone: "mute" });
  });

  it("off is off", () => {
    expect(sk({ enabled: false })).toMatchObject({ label: "Off", tone: "mute" });
  });

  it("the other agents still need the AI key, as before", () => {
    for (const agent of ["email-intel", "intake-triage", "post-consult"] as const) {
      expect(agentReadiness({ ...base, agent, aiConfigured: false }).label).toBe("On · needs the AI key");
    }
  });
});
