import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));

import { fakeAdmin } from "../mailbox/fake-db";
import { memDb, type Row, type Tables } from "../agents/mem-db";
import { fakeLlm, NOW, ORG } from "../agents/helpers";
import { resetLeadMergeSupport } from "@/lib/leads/live";
import { STAGE_BATCH_MAX, runConsultPrepScoped, startPrepOnStageEntries, startPrepOnStageEntry } from "@/lib/consult-prep/trigger";

const OTHER = "22222222-2222-2222-2222-222222222222";
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const lead = (id: string, over: Row = {}): Row => ({ id, org_id: ORG, first_name: "Dana", last_name: "Ruiz", business_name: "Sankofa", email: "dana@client.example", current_stage_id: "s-consult", stage_entered_at: ago(0.1), lawmatics_id: null, ...over });

function world(over: { tables?: Tables; modules?: string[]; setting?: boolean | null; autopilot?: boolean | null } = {}) {
  const tables: Tables = {
    crm_org: [{ id: ORG, queue_org_key: "firm-queue-key", modules: over.modules ?? ["agents"] }],
    agent_setting: over.setting === null ? [] : [{ org_id: ORG, agent: "consult-prep", enabled: over.setting ?? true, autonomy: "suggest" }],
    agent_autopilot: over.autopilot === null || over.autopilot === undefined ? [] : [{ org_id: ORG, paused: over.autopilot }],
    agent_run: [],
    crm_stage: [
      { id: "s-open", org_id: ORG, name: "Discovery", category: "open", order_index: 1 },
      { id: "s-consult", org_id: ORG, name: "Consultation Scheduled", category: "open", order_index: 2 },
      { id: "o-consult", org_id: OTHER, name: "Consultation Scheduled", category: "open", order_index: 2 },
    ],
    crm_lead: [lead("lead-1")],
    crm_calendar_event: [],
    crm_firm_brain_entry: [],
    crm_activity: [],
    crm_file: [],
    crm_intake_submission: [],
    crm_intake_form: [],
    crm_booth_scorecard: [],
    crm_meeting: [],
    crm_org_profile: [],
    ...over.tables,
  };
  const db = memDb(tables);
  const { client, log } = fakeAdmin(db.handler);
  const createDraft = vi.fn(async () => ({ id: "q-1" }));
  const deps = { admin: client as unknown as SupabaseClient, llm: fakeLlm({}).llm, createDraft, now: () => NOW, clock: () => Date.now() };
  return { db, log, createDraft, deps };
}

beforeEach(() => resetLeadMergeSupport());

describe("a lead entering the consult stage", () => {
  it("starts a prep for that ONE lead through the runner: a run row, the brief queued, the prep marked", async () => {
    const w = world({ tables: { crm_lead: [lead("lead-1"), lead("lead-2", { email: "two@client.example" })] } });
    const outcome = await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-consult" });
    expect(outcome).toMatchObject({ agent: "consult-prep", status: "ok", orgId: ORG });
    expect(w.db.tables.agent_run).toHaveLength(1);
    expect(w.db.tables.agent_run[0]).toMatchObject({ org_id: ORG, agent: "consult-prep", trigger: "event" });
    expect(w.createDraft).toHaveBeenCalledTimes(1);
    const marked = w.db.tables.crm_activity.filter((r) => r.type === "queue_drafted").map((r) => r.lead_id);
    expect(new Set(marked)).toEqual(new Set(["lead-1"]));
  });

  it("the org comes from the lead's own row, so another firm's stage never starts anything", async () => {
    const w = world({ tables: { crm_lead: [lead("lead-o", { org_id: OTHER, current_stage_id: "o-consult" })] } });
    const outcome = await startPrepOnStageEntry(w.deps, { leadId: "lead-o", toStageId: "o-consult" });
    expect(outcome).toBeNull(); // OTHER holds no Assistants feature in this world
    expect(w.db.tables.agent_run).toHaveLength(0);
    expect(w.createDraft).not.toHaveBeenCalled();
  });

  it("a stage that is not the consult stage starts nothing", async () => {
    const w = world({ tables: { crm_lead: [lead("lead-1", { current_stage_id: "s-open" })] } });
    expect(await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-open" })).toBeNull();
    expect(w.db.tables.agent_run).toHaveLength(0);
  });

  it("a lead that has already moved on (or was never there) starts nothing", async () => {
    const w = world({ tables: { crm_lead: [lead("lead-1", { current_stage_id: "s-open" })] } });
    expect(await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-consult" })).toBeNull();
    expect(await startPrepOnStageEntry(w.deps, { leadId: "nobody", toStageId: "s-consult" })).toBeNull();
    expect(w.db.tables.agent_run).toHaveLength(0);
  });

  it("a merged lead is never read as a lead to prep", async () => {
    const w = world({ tables: { crm_lead: [lead("lead-1", { merged_into_id: "lead-9" })] } });
    expect(await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-consult" })).toBeNull();
    expect(w.db.tables.agent_run).toHaveLength(0);
  });

  it("a firm with a mapping naming another stage as its consult stage is judged by that mapping", async () => {
    const w = world({
      tables: {
        crm_firm_brain_entry: [{ id: "m1", org_id: ORG, category: "stage_mapping", key: "consult-scheduled", body: "Discovery", data: {} }],
        crm_lead: [lead("lead-1", { current_stage_id: "s-open" })],
      },
    });
    const outcome = await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-open" });
    expect(outcome).toMatchObject({ status: "ok" });
  });

  it("every existing gate holds: the Assistants feature, the setting, Autopilot", async () => {
    for (const over of [{ modules: [] as string[] }, { setting: false }, { setting: null }, { autopilot: true }]) {
      const w = world(over);
      const outcome = await startPrepOnStageEntry(w.deps, { leadId: "lead-1", toStageId: "s-consult" });
      expect(outcome === null || outcome.status === "skipped", JSON.stringify(over)).toBe(true);
      expect(w.createDraft, JSON.stringify(over)).not.toHaveBeenCalled();
      expect(w.db.tables.agent_run.length === 0 || (outcome?.reason === "paused"), JSON.stringify(over)).toBe(true);
    }
  });

  it("never throws, whatever fails", async () => {
    const w = world();
    const broken = { ...w.deps, admin: { from: () => { throw new Error("boom"); } } as never };
    await expect(startPrepOnStageEntry(broken, { leadId: "lead-1", toStageId: "s-consult" })).resolves.toBeNull();
    await expect(runConsultPrepScoped(broken, { orgId: ORG, scope: { reason: "sync" } })).resolves.toBeNull();
  });
});

describe("a run scoped to the sync or a re-run", () => {
  it("the sync's run is for the whole firm and is an `event` run; a re-run is a `manual` one", async () => {
    const w = world();
    expect(await runConsultPrepScoped(w.deps, { orgId: ORG, scope: { reason: "sync" } })).toMatchObject({ status: "ok" });
    await runConsultPrepScoped(w.deps, { orgId: ORG, scope: { leadIds: ["lead-1"], reason: "rerun" }, trigger: "manual" });
    expect(w.db.tables.agent_run.map((r) => r.trigger)).toEqual(["event", "manual"]);
  });
  it("is off for a firm that has not switched the assistant on", async () => {
    const w = world({ setting: false });
    expect(await runConsultPrepScoped(w.deps, { orgId: ORG, scope: { reason: "sync" } })).toBeNull();
    expect(w.db.tables.agent_run).toHaveLength(0);
  });
});

describe("one request's moves are one small scoped run (F7, F8)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `lead-${i + 1}`);
  const leadsIn = (n: number, stage = "s-consult") => ids(n).map((id) => lead(id, { email: `${id}@client.example`, current_stage_id: stage }));

  it("seven leads moved into the stage in one request start ONE run for five of them and count the other two", async () => {
    const w = world({ tables: { crm_lead: leadsIn(7) } });
    const r = await startPrepOnStageEntries(w.deps, ids(7).map((leadId) => ({ leadId, toStageId: "s-consult" })));
    expect(STAGE_BATCH_MAX).toBe(5);
    expect(w.db.tables.agent_run).toHaveLength(1);
    expect(r.outcomes).toHaveLength(1);
    expect(r.over).toBe(2);
    expect(w.createDraft).toHaveBeenCalledTimes(5);
    expect(String(w.db.tables.agent_run[0].summary ?? "")).toMatch(/2 more leads entered the stage in the same request/);
    expect(new Set(w.db.tables.crm_activity.filter((x) => x.type === "queue_drafted").map((x) => x.lead_id)).size).toBe(5);
  });

  it("a lead moved into a lost stage starts a scoped run too (it cancels that lead's reminders), and a plain open stage starts nothing", async () => {
    const stages = [
      { id: "s-open", org_id: ORG, name: "Discovery", category: "open", order_index: 1 },
      { id: "s-consult", org_id: ORG, name: "Consultation Scheduled", category: "open", order_index: 2 },
      { id: "s-lost", org_id: ORG, name: "Lost", category: "lost", order_index: 9 },
    ];
    const lost = world({ tables: { crm_stage: stages, crm_lead: [lead("lead-1", { current_stage_id: "s-lost" })] } });
    const r = await startPrepOnStageEntries(lost.deps, [{ leadId: "lead-1", toStageId: "s-lost" }]);
    expect(r.outcomes).toHaveLength(1);
    expect(lost.db.tables.agent_run).toHaveLength(1);
    const plain = world({ tables: { crm_stage: stages, crm_lead: [lead("lead-1", { current_stage_id: "s-open" })] } });
    expect((await startPrepOnStageEntries(plain.deps, [{ leadId: "lead-1", toStageId: "s-open" }])).outcomes).toHaveLength(0);
    expect(plain.db.tables.agent_run).toHaveLength(0);
  });

  it("never throws", async () => {
    const broken = { ...world().deps, admin: { from: () => { throw new Error("boom"); } } as never };
    await expect(startPrepOnStageEntries(broken, [{ leadId: "lead-1", toStageId: "s-consult" }])).resolves.toEqual({ outcomes: [], over: 0 });
  });
});

describe("the 5 AM sweep and a firm that switched consult prep off (R3.7)", () => {
  it("calls the cancel step for a firm whose setting is off or missing, never for one that is on, and a throw is swallowed", async () => {
    const { runAllAgents } = await import("@/lib/agents/runner");
    for (const [setting, expected] of [[false, 1], [null, 1], [true, 0]] as const) {
      const w = world({ setting });
      const spy = vi.fn(async () => { throw new Error("boom"); });
      await expect(runAllAgents({ ...w.deps, cancelScheduledWhenOff: spy } as never)).resolves.toBeDefined();
      expect(spy, String(setting)).toHaveBeenCalledTimes(expected);
      if (expected) expect(spy).toHaveBeenCalledWith(ORG);
    }
  });
});
