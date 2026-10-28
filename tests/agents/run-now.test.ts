import { describe, it, expect } from "vitest";
import { AGENT_IDS, agentNeedsAi, type AgentId } from "@/lib/agents/types";
import { agentNeedsDatabaseUpdate, agentReadiness } from "@/lib/agents/readiness";
import {
  autopilotForRun,
  canRunAgents,
  decideRunNow,
  RUN_NOW_REASON,
  runResultLine,
  type RunNowInput,
} from "@/lib/agents/run-now";

/** An owner, the agent on, nothing in the way. Each case changes one thing. */
const ready = (over: Partial<RunNowInput> = {}): RunNowInput => ({
  agent: "intake-triage",
  role: "owner",
  enabled: true,
  autopilot: "clear",
  aiConfigured: true,
  databaseUpdate: "applied",
  ...over,
});

describe("decideRunNow: the seven outcomes, exact sentences", () => {
  it.each([
    ["running", { running: true }, "Running. This can take a minute."],
    ["role", { role: "paralegal" as const }, "Senior admin or above can run assistants."],
    ["database update", { agent: "morning-brief" as AgentId, databaseUpdate: "pending" as const }, "This isn't switched on for your firm yet. Lectual will turn it on."],
    ["off", { enabled: false }, "Switch the assistant on first."],
    ["Autopilot paused", { autopilot: "paused" as const }, "Assistants paused for your firm, so none of them run. Resume them first."],
    ["Autopilot unreadable", { autopilot: "unreadable" as const }, "We couldn't check whether assistants are paused, so nothing will run."],
    ["AI key", { aiConfigured: false }, "AI isn't switched on for your firm yet. Lectual will turn it on."],
  ])("%s", (_name, over, sentence) => {
    const d = decideRunNow(ready(over));
    expect(d.canRun).toBe(false);
    if (!d.canRun) expect(d.reason).toBe(sentence);
  });

  it("an owner with the agent on and nothing in the way can run, with no reason", () => {
    expect(decideRunNow(ready())).toEqual({ canRun: true });
  });

  it("a pending update that the agent does not depend on does not block it", () => {
    expect(decideRunNow(ready({ agent: "email-intel", databaseUpdate: "pending" })).canRun).toBe(true);
    expect(decideRunNow(ready({ agent: "stage-keeper", databaseUpdate: "pending" })).canRun).toBe(true);
  });

  it("an unknown update state (a failed probe) blocks nothing", () => {
    expect(decideRunNow(ready({ agent: "morning-brief", databaseUpdate: "unknown" })).canRun).toBe(true);
  });

  it("only the unreadable Autopilot state is a warning; the rest read as explanations", () => {
    const tone = (over: Partial<RunNowInput>) => {
      const d = decideRunNow(ready(over));
      return d.canRun ? null : d.tone;
    };
    expect(tone({ autopilot: "unreadable" })).toBe("warn");
    for (const over of [{ running: true }, { role: "viewer" as const }, { enabled: false }, { autopilot: "paused" as const }, { aiConfigured: false }]) {
      expect(tone(over)).toBe("note");
    }
  });
});

describe("decideRunNow: precedence, first cause that applies wins", () => {
  const sentence = (over: Partial<RunNowInput>) => {
    const d = decideRunNow(ready(over));
    return d.canRun ? null : d.reason;
  };

  it("running beats everything", () => {
    expect(sentence({ running: true, role: "viewer", enabled: false, autopilot: "paused", aiConfigured: false })).toBe(RUN_NOW_REASON.running);
  });
  it("role beats off", () => {
    expect(sentence({ role: "viewer", enabled: false })).toBe(RUN_NOW_REASON.role);
  });
  it("role beats the database update", () => {
    expect(sentence({ role: "attorney", agent: "consult-prep", databaseUpdate: "pending" })).toBe(RUN_NOW_REASON.role);
  });
  it("the database update beats off", () => {
    expect(sentence({ agent: "inbox-summary", databaseUpdate: "pending", enabled: false })).toBe(RUN_NOW_REASON["database-update"]);
  });
  it("off beats Autopilot paused", () => {
    expect(sentence({ enabled: false, autopilot: "paused" })).toBe(RUN_NOW_REASON.off);
  });
  it("off beats the AI key", () => {
    expect(sentence({ enabled: false, aiConfigured: false })).toBe(RUN_NOW_REASON.off);
  });
  it("Autopilot paused beats the AI key", () => {
    expect(sentence({ autopilot: "paused", aiConfigured: false })).toBe(RUN_NOW_REASON["autopilot-paused"]);
  });
  it("Autopilot unreadable beats the AI key", () => {
    expect(sentence({ autopilot: "unreadable", aiConfigured: false })).toBe(RUN_NOW_REASON["autopilot-unreadable"]);
  });
  it("the same agent gives four different sentences as its state changes", () => {
    const seen = new Set([
      sentence({ enabled: false }),
      sentence({ autopilot: "paused" }),
      sentence({ aiConfigured: false }),
      sentence({ role: "viewer" }),
    ]);
    expect(seen.size).toBe(4);
  });
});

describe("decideRunNow: the Stage Keeper and the AI key", () => {
  it("the Stage Keeper calls no model, so a missing key never blocks it", () => {
    expect(decideRunNow(ready({ agent: "stage-keeper", aiConfigured: false })).canRun).toBe(true);
  });
  it("every other agent is blocked by a missing key", () => {
    for (const agent of AGENT_IDS.filter((a) => a !== "stage-keeper")) {
      const d = decideRunNow(ready({ agent, aiConfigured: false }));
      expect(d.canRun, agent).toBe(false);
      if (!d.canRun) expect(d.block).toBe("ai-key");
    }
  });
  it("agrees with agentNeedsAi", () => {
    for (const agent of AGENT_IDS) expect(decideRunNow(ready({ agent, aiConfigured: false })).canRun).toBe(!agentNeedsAi(agent));
  });
});

describe("decideRunNow: Autopilot states", () => {
  it("a table that isn't set up blocks nothing", () => {
    expect(decideRunNow(ready({ autopilot: "not-set-up" })).canRun).toBe(true);
  });
  it("autopilotForRun maps each read", () => {
    expect(autopilotForRun({ status: "missing" })).toBe("not-set-up");
    expect(autopilotForRun({ status: "unavailable" })).toBe("unreadable");
    expect(autopilotForRun({ status: "ok", state: { paused: true } })).toBe("paused");
    expect(autopilotForRun({ status: "ok", state: { paused: false } })).toBe("clear");
  });
});

describe("decideRunNow: the database update", () => {
  it("blocks exactly the three agents that need it, and only when it is pending", () => {
    const blocked = AGENT_IDS.filter((agent) => !decideRunNow(ready({ agent, databaseUpdate: "pending" })).canRun);
    expect(blocked).toEqual(["morning-brief", "consult-prep", "inbox-summary"]);
    expect(blocked.every(agentNeedsDatabaseUpdate)).toBe(true);
  });
  it("shares its wording with the readiness label", () => {
    const readiness = agentReadiness({ agent: "morning-brief", enabled: true, hasMailboxModule: true, mailbox: "ok", aiConfigured: true, queue: "ok", databaseUpdate: "pending" });
    expect(RUN_NOW_REASON["database-update"]).toBe(readiness.reason);
  });
});

describe("canRunAgents", () => {
  it("is the admin tier and nobody else, and fails closed", () => {
    for (const role of ["owner", "admin", "senior_admin"] as const) expect(canRunAgents(role)).toBe(true);
    for (const role of ["attorney", "intake", "paralegal", "clerk", "viewer", "social_media"] as const) expect(canRunAgents(role)).toBe(false);
    expect(canRunAgents(null)).toBe(false);
    expect(canRunAgents(undefined)).toBe(false);
  });
});

describe("runResultLine", () => {
  it("nothing yet draws nothing", () => {
    expect(runResultLine({})).toBeNull();
  });
  it("success: the summary and the counts", () => {
    expect(runResultLine({ ok: true, message: "Scored 3 leads.", itemsIn: 5, draftsOut: 2 })).toEqual({ text: "Scored 3 leads. · 5 read, 2 drafts written", alert: false });
  });
  it("one draft is singular", () => {
    expect(runResultLine({ ok: true, message: "Done it.", itemsIn: 1, draftsOut: 1 })?.text).toContain("1 read, 1 draft written");
  });
  it("success without counts is just the summary", () => {
    expect(runResultLine({ ok: true, message: "Ran." })).toEqual({ text: "Ran.", alert: false });
  });
  it("skipped: the summary with the skip wording, no counts", () => {
    expect(runResultLine({ ok: true, skipped: true, message: "No approval queue is connected.", itemsIn: 0, draftsOut: 0 })).toEqual({
      text: "Skipped. No approval queue is connected.",
      alert: false,
    });
  });
  it("an error is the only alert", () => {
    expect(runResultLine({ error: "The run failed: boom" })).toEqual({ text: "The run failed: boom", alert: true });
  });
});
