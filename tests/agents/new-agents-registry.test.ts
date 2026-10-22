import { describe, it, expect, vi } from "vitest";
import {
  AGENT_DEFS,
  AGENT_IDS,
  AUTONOMY_HINT,
  agentNeedsAi,
  autonomyHint,
  type AgentId,
} from "@/lib/agents/types";
import {
  DEFAULT_MINUTES_PER_TASK,
  TASK_UNIT,
  estimateAssumption,
  estimateHoursSaved,
  parseMinutesForm,
  resolveMinutes,
  tasksInRun,
} from "@/lib/agents/autopilot-rules";
import { buildRunDigest, type DigestRun } from "@/lib/agents/digest";
import { agentReadiness, type AgentReadinessInput } from "@/lib/agents/readiness";

const NEW_AGENTS = ["morning-brief", "consult-prep", "inbox-summary"] as const;
const ORG = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-21T14:00:00Z");

describe("the registry (F18)", () => {
  it("has seven agents, the three new ones last, each fully defined", () => {
    expect(AGENT_IDS).toEqual(["email-intel", "intake-triage", "post-consult", "stage-keeper", "morning-brief", "consult-prep", "inbox-summary"]);
    expect(AGENT_DEFS["morning-brief"]).toMatchObject({ name: "Morning brief", reads: "Leads, matters, consults and the queue", defaultAutonomy: "draft" });
    expect(AGENT_DEFS["consult-prep"]).toMatchObject({ name: "Consult prep", reads: "Outlook consults and the lead record", defaultAutonomy: "draft" });
    expect(AGENT_DEFS["inbox-summary"]).toMatchObject({ name: "Inbox summary", reads: "Connected mailboxes", defaultAutonomy: "draft" });
    for (const id of NEW_AGENTS) {
      expect(AGENT_DEFS[id].description).toMatch(/only drafts/i);
      expect(AGENT_DEFS[id].description).toMatch(/an attorney reviews/);
      expect(agentNeedsAi(id)).toBe(true);
    }
  });

  it("each agent has a hint saying what suggest, draft and act do, and none says it sends", () => {
    for (const id of NEW_AGENTS) {
      for (const level of ["suggest", "draft", "act"] as const) {
        expect(autonomyHint(id, level)).not.toBe(AUTONOMY_HINT[level]);
        expect(autonomyHint(id, level)).not.toMatch(/\bsends? (it|the|an)\b/i);
      }
      expect(autonomyHint(id, "draft")).toBe(autonomyHint(id, "act")); // draft and act behave the same
      expect(autonomyHint(id, "suggest")).toMatch(/only/i);
      expect(autonomyHint(id, "draft")).toMatch(/nothing is sent/i);
    }
  });
});

describe("Hours saved and the minutes form include the three (D4)", () => {
  it("defaults and units", () => {
    expect(DEFAULT_MINUTES_PER_TASK).toMatchObject({ "morning-brief": 5, "consult-prep": 15, "inbox-summary": 3 });
    expect(TASK_UNIT["consult-prep"]).toEqual({ singular: "consult prepped", plural: "consults prepped" });
    expect(resolveMinutes(null).minutes["inbox-summary"]).toBe(3);
  });

  it("morning-brief and inbox-summary count the drafts written; consult-prep counts consults prepped; a failed or skipped run counts nothing", () => {
    const run = (agent: string, status: string, items_in: number, drafts_out: number) => ({ agent, status, items_in, drafts_out, started_at: NOW.toISOString() });
    expect(tasksInRun(run("morning-brief", "ok", 9, 4))).toBe(4);
    expect(tasksInRun(run("inbox-summary", "ok", 30, 3))).toBe(3);
    expect(tasksInRun(run("consult-prep", "ok", 2, 4))).toBe(2);
    for (const agent of NEW_AGENTS) {
      expect(tasksInRun(run(agent, "error", 5, 5))).toBe(0);
      expect(tasksInRun(run(agent, "skipped", 5, 5))).toBe(0);
    }
    const est = estimateHoursSaved([run("morning-brief", "ok", 9, 4), run("consult-prep", "ok", 2, 4), run("inbox-summary", "ok", 30, 3)], DEFAULT_MINUTES_PER_TASK);
    // 4 x 5 + 2 x 15 + 3 x 3 = 59 minutes
    expect(est.tasks).toMatchObject({ "morning-brief": 4, "consult-prep": 2, "inbox-summary": 3 });
    expect(est.hours).toBe(1);
    expect(estimateAssumption(DEFAULT_MINUTES_PER_TASK)).toContain("15 min per consult prepped");
  });

  it("the minutes form reads a field for each of the three", () => {
    const fd = new FormData();
    fd.set("minutes-morning-brief", "7");
    fd.set("minutes-consult-prep", "20.5");
    fd.set("minutes-inbox-summary", "");
    expect(parseMinutesForm(fd)).toEqual({ ok: true, value: { "morning-brief": 7, "consult-prep": 20.5 } });
  });
});

describe("the Overnight digest lines (D4)", () => {
  const run = (over: Partial<DigestRun> & { agent: string }): DigestRun => ({
    status: "ok",
    started_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
    items_in: 0,
    drafts_out: 0,
    summary: null,
    error: null,
    ...over,
  });
  const lines = (runs: DigestRun[]) => {
    const out = buildRunDigest(runs, NOW);
    if (out.status !== "ok") throw new Error("expected ok");
    return out;
  };

  it("morning-brief: the brief and the follow-ups, linked to the queue", () => {
    expect(lines([run({ agent: "morning-brief", items_in: 9, drafts_out: 4 })]).lines[0]).toMatchObject({
      agent: "morning-brief",
      name: "Morning brief",
      text: "wrote the morning brief · 3 follow-ups drafted (in the Queue)",
      tone: "attention",
      href: "/dashboard/queue/",
    });
    expect(lines([run({ agent: "morning-brief", items_in: 4, drafts_out: 1 })]).lines[0]).toMatchObject({ text: "wrote the morning brief", tone: "ok" });
    expect(lines([run({ agent: "morning-brief", items_in: 0, drafts_out: 1 })]).lines[0]).toMatchObject({ text: "wrote the morning brief · nothing to report", tone: "quiet" });
    expect(lines([run({ agent: "morning-brief", drafts_out: 2 }), run({ agent: "morning-brief", drafts_out: 1, items_in: 1 })]).lines[0].text).toBe("wrote the morning brief (2 runs) · 1 follow-up drafted (in the Queue)");
  });

  it("consult-prep: consults prepped, with the drafts waiting; a quiet line when there were none", () => {
    expect(lines([run({ agent: "consult-prep", items_in: 2, drafts_out: 4 })]).lines[0]).toMatchObject({ text: "prepped 2 consults · 4 drafts (in the Queue)", tone: "attention", href: "/dashboard/queue/" });
    expect(lines([run({ agent: "consult-prep", items_in: 1, drafts_out: 1 })]).lines[0].text).toBe("prepped 1 consult · 1 draft (in the Queue)");
    expect(lines([run({ agent: "consult-prep" })]).lines[0]).toMatchObject({ text: "found no consults to prep", tone: "quiet" });
  });

  it("inbox-summary: the inbox and the Outlook replies; a quiet line when there was no mail", () => {
    expect(lines([run({ agent: "inbox-summary", items_in: 42, drafts_out: 3 })]).lines[0]).toMatchObject({ text: "summarised the inbox (42 messages) · 2 reply drafts in Outlook", tone: "attention" });
    expect(lines([run({ agent: "inbox-summary", items_in: 1, drafts_out: 1 })]).lines[0]).toMatchObject({ text: "summarised the inbox (1 message)", tone: "ok" });
    expect(lines([run({ agent: "inbox-summary", items_in: 0, drafts_out: 0 })]).lines[0]).toMatchObject({ text: "found no new mail to summarise", tone: "quiet" });
  });

  it("a skipped run shows its reason in words, and a failed latest run is reported with the usual action link, or Lectual-told when the firm cannot fix it", () => {
    const skipped = lines([run({ agent: "inbox-summary", status: "skipped", summary: "Skipped: the Mailboxes module is off." })]);
    expect(skipped.lines[0].text).toBe("didn't run: Skipped: the Mailboxes module is off.");
    const failed = lines([run({ agent: "inbox-summary", status: "error", error: "The inbox summary could not be written: none of the connected mailboxes could be read." })]);
    expect(failed.failures[0]).toMatchObject({ agent: "inbox-summary", text: "Inbox summary couldn't finish its last run", action: { label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" } });
    const brief = lines([run({ agent: "morning-brief", status: "error", error: "The morning brief could not be written: none of its six sections could be read." })]);
    expect(brief.failures[0]).toMatchObject({ agent: "morning-brief", text: "Morning brief couldn't finish its last run", action: { label: "Lectual has been told and is looking into it.", href: null } });
  });
});

describe("readiness for the three (D3)", () => {
  const base: AgentReadinessInput = { agent: "inbox-summary", enabled: true, hasMailboxModule: true, mailbox: "ok", aiConfigured: true, queue: "ok", calendar: "ok", databaseUpdate: "applied" };
  const r = (over: Partial<AgentReadinessInput>) => agentReadiness({ ...base, ...over });

  it("ready only when it can actually run", () => {
    for (const agent of NEW_AGENTS) expect(r({ agent })).toMatchObject({ label: "On", tone: "ok" });
  });

  it("precedence: database update, then the module, then the AI key, then the agent's own requirement, then the queue", () => {
    const worst = { mailbox: "none", calendar: "none", queue: "none", aiConfigured: false, hasMailboxModule: false, databaseUpdate: "pending" } as const;
    expect(r({ ...worst }).label).toBe("Not available until the database update");
    expect(r({ ...worst, databaseUpdate: "applied" }).label).toBe("Needs the Mailboxes module");
    expect(r({ ...worst, databaseUpdate: "applied", hasMailboxModule: true }).label).toBe("On · needs the AI key");
    expect(r({ ...worst, databaseUpdate: "applied", hasMailboxModule: true, aiConfigured: true }).label).toBe("On · waiting for a mailbox");
    expect(r({ ...worst, databaseUpdate: "applied", hasMailboxModule: true, aiConfigured: true, mailbox: "ok" }).label).toBe("On · needs an approval queue");
  });

  it("the database update pending shows whether or not the agent is on, and an Off agent keeps no other label", () => {
    for (const agent of NEW_AGENTS) {
      expect(r({ agent, enabled: false, databaseUpdate: "pending" })).toMatchObject({ label: "Not available until the database update", tone: "mute" });
      expect(r({ agent, enabled: true, databaseUpdate: "pending" })).toMatchObject({ label: "Not available until the database update", tone: "warn" });
      expect(r({ agent, enabled: false })).toMatchObject({ label: "Off", tone: "mute" });
    }
    // an unknown state (no probe) says nothing
    expect(r({ databaseUpdate: "unknown" }).label).toBe("On");
    expect(r({ databaseUpdate: undefined }).label).toBe("On");
  });

  it("inbox-summary needs a mailbox: the module, an active one, and a readable list", () => {
    expect(r({ hasMailboxModule: false })).toMatchObject({ label: "Needs the Mailboxes module" });
    expect(r({ mailbox: "none" })).toMatchObject({ label: "On · waiting for a mailbox", tone: "warn" });
    expect(r({ mailbox: "unavailable" })).toMatchObject({ label: "On · couldn't check mailboxes", tone: "warn" });
  });

  it("consult-prep needs calendar events: the module, readable events, and a readable calendar", () => {
    const c = (over: Partial<AgentReadinessInput>) => r({ agent: "consult-prep", ...over });
    expect(c({ hasMailboxModule: false })).toMatchObject({ label: "Needs the Mailboxes module" });
    expect(c({ calendar: "none" })).toMatchObject({ label: "On · waiting for calendar events", tone: "warn" });
    expect(c({ calendar: "unavailable" })).toMatchObject({ label: "On · couldn't check the calendar", tone: "warn" });
    // a mailbox alone is not enough for consult prep
    expect(c({ calendar: "none", mailbox: "ok" }).tone).toBe("warn");
  });

  it("morning-brief needs the queue, and does not need the Mailboxes module", () => {
    const m = (over: Partial<AgentReadinessInput>) => r({ agent: "morning-brief", ...over });
    expect(m({ hasMailboxModule: false, mailbox: "none", calendar: "none" })).toMatchObject({ label: "On", tone: "ok" });
    expect(m({ queue: "none" })).toMatchObject({ label: "On · needs an approval queue", tone: "warn" });
    expect(m({ queue: "unavailable" })).toMatchObject({ label: "On · couldn't reach the queue", tone: "warn" });
  });

  it("every agent that writes a queue draft also reports the queue after its own requirement", () => {
    for (const agent of ["inbox-summary", "consult-prep"] as const) {
      expect(r({ agent, queue: "none" }).label).toBe("On · needs an approval queue");
      expect(r({ agent, queue: "unavailable" }).label).toBe("On · couldn't reach the queue");
    }
  });

  it("the reasons are whole sentences that name what to do, and never carry a raw error", () => {
    const all: AgentReadinessInput[] = [];
    for (const agent of NEW_AGENTS) {
      for (const over of [{ databaseUpdate: "pending" }, { hasMailboxModule: false }, { aiConfigured: false }, { mailbox: "none" }, { mailbox: "unavailable" }, { calendar: "none" }, { calendar: "unavailable" }, { queue: "none" }, { queue: "unavailable" }] as const) {
        all.push({ ...base, agent, ...over });
      }
    }
    for (const input of all) {
      const out = agentReadiness(input);
      expect(out.reason).toMatch(/[.]$/);
      expect(out.reason).not.toMatch(/PGRST|42703|23514|violates|constraint|undefined|null/);
    }
    expect(r({ databaseUpdate: "pending" }).reason).toContain("Ask Lectual to apply the database update");
  });
});

describe("saving a setting before lectual 0098 (F19)", () => {
  it("returns the 'isn't available until the database update' message for each of the four, and leaves other agents' messages alone", async () => {
    vi.resetModules();
    let error: { code?: string; message: string } | null = { code: "23514", message: 'new row for relation "agent_setting" violates check constraint "agent_setting_agent"' };
    vi.doMock("next/cache", () => ({ refresh: () => {} }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: async () => true }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", org: { id: ORG }, user: { id: "u" }, role: "owner" }) }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ from: () => ({ upsert: async () => ({ error }) }) }) }));
    const { saveAgentSettingAction } = await import("@/app/dashboard/agents/actions");
    const fd = (agent: string) => {
      const f = new FormData();
      f.set("agent", agent);
      f.set("autonomy", "draft");
      f.set("enabled", "true");
      return f;
    };
    for (const agent of [...NEW_AGENTS, "stage-keeper"] as AgentId[]) {
      const refused = await saveAgentSettingAction({}, fd(agent));
      expect(refused.error).toMatch(/isn't available until the database update \(lectual 0098\) is applied\. Nothing was changed\.$/);
      expect(refused.error).not.toMatch(/violates|constraint|agent_setting"/);
    }
    expect((await saveAgentSettingAction({}, fd("morning-brief"))).error).toBe("The Morning brief isn't available until the database update (lectual 0098) is applied. Nothing was changed.");
    expect((await saveAgentSettingAction({}, fd("stage-keeper"))).error).toBe("The Stage Keeper isn't available until the database update (lectual 0098) is applied. Nothing was changed.");

    // another database error on a new agent is still a plain "Couldn't save"
    error = { code: "42501", message: "permission denied for table agent_setting" };
    expect((await saveAgentSettingAction({}, fd("inbox-summary"))).error).toBe("Couldn't save: permission denied for table agent_setting");
    // the four older agents keep their existing wording
    error = { code: "23514", message: "check constraint" };
    for (const agent of ["email-intel", "intake-triage", "post-consult"]) {
      expect((await saveAgentSettingAction({}, fd(agent))).error).toBe("Couldn't save: check constraint");
    }
    error = null;
    expect(await saveAgentSettingAction({}, fd("consult-prep"))).toEqual({ ok: true });
    vi.resetModules();
  });
});
