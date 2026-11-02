import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runStageKeeperAfterSync } from "../../src/lib/agents/stage-keeper/after-sync";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { assertOrgFenced, NOW } from "../agents/helpers";
import { event, keeperHandler, lead, mail, stageRows, type KeeperDb, type Row } from "./db";
import { L, ORG, OTHER_ORG, S, daysAgo } from "./fixtures";

/** A database with two firms: the crm_org rows say which hold the `agents` module. */
function world(over: { modules?: string[]; settings?: Row[]; paused?: boolean; leadsSecondOrg?: boolean } = {}) {
  const db: KeeperDb = {
    tables: {
      crm_org: [
        { id: ORG, modules: over.modules ?? ["agents", "mailbox"], queue_org_key: null },
        { id: OTHER_ORG, modules: ["mailbox"], queue_org_key: null },
      ],
      agent_setting: over.settings ?? [{ org_id: ORG, agent: "stage-keeper", enabled: true, autonomy: "act" }],
      agent_autopilot: over.paused ? [{ org_id: ORG, paused: true }] : [],
      agent_run: [],
      crm_stage: stageRows(),
      crm_lead: [lead(L.amara, S.newPnc)],
      crm_activity: [mail(L.amara, "loe-invoice")],
      crm_calendar_event: [],
      crm_firm_brain_entry: [],
    },
  };
  const handler = keeperHandler(db, () => NOW);
  const { client, log } = fakeAdmin((q: Recorded) => {
    // `.contains("modules", [...])` on crm_org: the fake's matcher handles it; everything else is the stateful handler.
    return handler(q);
  });
  const llm = vi.fn(async () => {
    throw new Error("the Stage Keeper must not call a model");
  });
  const createDraft = vi.fn(async () => ({ id: "q" }));
  const deps = { admin: client as unknown as SupabaseClient, llm: llm as never, createDraft, now: () => NOW };
  return { db, log, deps, llm, createDraft };
}

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("F13 the step right after the sync", () => {
  it("runs the enabled Stage Keeper for a firm the sync touched, as an event run, with no AI key", async () => {
    const w = world();
    const result = await runStageKeeperAfterSync(w.deps, [ORG]);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ agent: "stage-keeper", status: "ok" });
    expect(w.db.tables.agent_run[0]).toMatchObject({ agent: "stage-keeper", trigger: "event", status: "ok" });
    expect(w.db.tables.crm_lead[0].current_stage_id).toBe(S.loe);
    expect(w.llm).not.toHaveBeenCalled();
    expect(w.createDraft).not.toHaveBeenCalled();
  });

  it("uses the autonomy the firm chose: suggest writes a card and leaves the lead", async () => {
    const w = world({ settings: [{ org_id: ORG, agent: "stage-keeper", enabled: true, autonomy: "suggest" }] });
    await runStageKeeperAfterSync(w.deps, [ORG]);
    expect(w.db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
    expect(w.db.tables.crm_activity.filter((r) => r.payload?.kind === "stage_suggestion")).toHaveLength(1);
  });

  it("a firm with the agent off, or with no setting row, is not run", async () => {
    for (const settings of [[{ org_id: ORG, agent: "stage-keeper", enabled: false, autonomy: "act" }], []]) {
      const w = world({ settings });
      const result = await runStageKeeperAfterSync(w.deps, [ORG]);
      expect(result.runs).toEqual([]);
      expect(w.db.tables.agent_run).toEqual([]);
      expect(w.db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
    }
  });

  it("a firm without the agents module is not run, even with the setting on", async () => {
    const w = world({ modules: ["mailbox"] });
    expect((await runStageKeeperAfterSync(w.deps, [ORG])).runs).toEqual([]);
    expect(w.db.tables.agent_run).toEqual([]);
  });

  it("a paused Autopilot stops it, with no run row", async () => {
    const w = world({ paused: true });
    const result = await runStageKeeperAfterSync(w.deps, [ORG]);
    expect(result.runs[0]).toMatchObject({ status: "skipped", reason: "paused" });
    expect(w.db.tables.agent_run).toEqual([]);
    expect(w.db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
  });

  it("only the firms the sync touched are looked at", async () => {
    const w = world();
    await runStageKeeperAfterSync(w.deps, [OTHER_ORG]);
    expect(w.db.tables.agent_run).toEqual([]);
    expect(w.db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
    expect((await runStageKeeperAfterSync(w.deps, [])).runs).toEqual([]);
  });

  it("a failure inside one firm's run never throws out of the step", async () => {
    const w = world();
    w.db.refuse = (q) => (q.table === "crm_stage" ? { message: "boom" } : undefined);
    const result = await runStageKeeperAfterSync(w.deps, [ORG, OTHER_ORG]);
    expect(result.runs[0]).toMatchObject({ status: "error" });
  });

  it("a read that throws is swallowed, not raised", async () => {
    const w = world();
    const broken = { ...w.deps, admin: { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient };
    await expect(runStageKeeperAfterSync(broken, [ORG])).resolves.toEqual({ held: expect.any(Array), runs: [] });
  });

  it("every statement it issues names a firm", async () => {
    const w = world();
    await runStageKeeperAfterSync(w.deps, [ORG]);
    expect(() => assertOrgFenced(w.log)).not.toThrow();
  });

  it("the held-consult step runs whether or not the agent is switched on", async () => {
    const w = world({ settings: [] });
    w.db.tables.crm_calendar_event = [event(L.amara, { starts_at: daysAgo(1), ends_at: daysAgo(1) })];
    const result = await runStageKeeperAfterSync(w.deps, [ORG]);
    expect(result.held[0]).toMatchObject({ orgId: ORG, state: "ok", bumped: 1 });
    expect(result.runs).toEqual([]);
  });
});

// ── through the real route ───────────────────────────────────────────────────

describe("the mailbox-sync route", () => {
  const afterSync = vi.fn();
  const runMailboxSync = vi.fn();

  function load(opts: { root?: Buffer | null; deps?: () => unknown } = {}) {
    vi.resetModules();
    afterSync.mockReset();
    afterSync.mockResolvedValue({ held: [], runs: [] });
    runMailboxSync.mockReset();
    runMailboxSync.mockResolvedValue({
      orgs: 2,
      connections: 3,
      ok: 2,
      failed: 1,
      outcomes: [
        { id: "c1", orgId: ORG, ok: true },
        { id: "c2", orgId: ORG, ok: true },
        { id: "c3", orgId: OTHER_ORG, ok: false, status: "error" },
      ],
      calendar: [],
    });
    vi.doMock("@/lib/env", () => ({ env: { CRON_SECRET: "s3cret" } }));
    vi.doMock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
    vi.doMock("@/lib/mailbox/config", () => ({ providerCredentials: () => null, rootKeyOrNull: () => (opts.root === undefined ? Buffer.alloc(32) : opts.root) }));
    vi.doMock("@/lib/mailbox/sync", () => ({ runMailboxSync }));
    vi.doMock("@/lib/agents/deps", () => ({ productionRunnerDeps: opts.deps ?? (() => ({ marker: "deps" })) }));
    vi.doMock("@/lib/agents/stage-keeper/after-sync", () => ({ runStageKeeperAfterSync: afterSync }));
    return import("../../src/app/api/cron/mailbox-sync/route");
  }
  const req = (token = "s3cret") => ({ headers: { get: (h: string) => (h.toLowerCase() === "authorization" ? `Bearer ${token}` : null) } }) as never;
  afterEach(() => {
    vi.doUnmock("@/lib/env");
    vi.doUnmock("@/lib/db/admin");
    vi.doUnmock("@/lib/mailbox/config");
    vi.doUnmock("@/lib/mailbox/sync");
    vi.doUnmock("@/lib/agents/deps");
    vi.doUnmock("@/lib/agents/stage-keeper/after-sync");
  });

  it("runs the step after the sync with the firms it touched, and the response is exactly what it was", async () => {
    const { GET } = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orgs: 2, connections: 3, succeeded: 2, failed: 1 });
    expect(afterSync).toHaveBeenCalledTimes(1);
    expect(afterSync.mock.calls[0][0]).toEqual({ marker: "deps" });
    expect([...new Set(afterSync.mock.calls[0][1] as string[])].sort()).toEqual([ORG, OTHER_ORG].sort());
    expect(runMailboxSync.mock.invocationCallOrder[0]).toBeLessThan(afterSync.mock.invocationCallOrder[0]);
  });

  it("a Stage Keeper failure changes neither the status nor the JSON", async () => {
    const { GET } = await load();
    afterSync.mockRejectedValue(new Error("stage keeper exploded"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orgs: 2, connections: 3, succeeded: 2, failed: 1 });
  });

  it("failing to build the runner deps changes nothing either", async () => {
    const { GET } = await load({
      deps: () => {
        throw new Error("no env");
      },
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(afterSync).not.toHaveBeenCalled();
  });

  it("an unauthorised request, or a deployment with no mailbox key, runs neither the sync nor the step", async () => {
    const a = await load();
    expect((await a.GET(req("wrong"))).status).toBe(401);
    const b = await load({ root: null });
    expect((await b.GET(req())).status).toBe(503);
    expect(afterSync).not.toHaveBeenCalled();
    expect(runMailboxSync).not.toHaveBeenCalled();
  });

  it("vercel.json is unchanged: the same three crons, no new one", () => {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string; schedule: string }[];
    expect(crons.map((c) => c.path)).toEqual(["/api/cron/mailbox-sync/", "/api/cron/agents/", "/api/cron/meetings-import/", "/api/cron/lawmatics-matters/"]);
  });

  it("the route adds no admin client of its own: the step reaches the runner only through productionRunnerDeps", () => {
    const src = readFileSync("src/app/api/cron/mailbox-sync/route.ts", "utf8");
    expect(src.match(new RegExp(["get", "AdminClient\\("].join(""), "g"))).toHaveLength(1);
    expect(src).toContain("productionRunnerDeps()");
    expect(src).not.toMatch(/aiConfigured|ANTHROPIC/);
  });
});
