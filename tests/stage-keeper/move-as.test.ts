import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moveLeadStageAs, type AgentActor, type AgentMove } from "../../src/lib/pipeline/move-as";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { assertOrgFenced } from "../agents/helpers";
import { keeperHandler, lead, stageRows, type KeeperDb, type Row } from "./db";
import { L, ORG, OTHER_ORG, S, SENTINEL } from "./fixtures";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const MAIL_EVIDENCE = { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-09-20T10:00:00Z", subject: "Your engagement letter" } as const;

function setup(over: { leads?: Row[]; stages?: Row[]; refuse?: KeeperDb["refuse"]; beforeUpdate?: (db: KeeperDb) => void } = {}) {
  const db: KeeperDb = {
    tables: { crm_stage: over.stages ?? stageRows(), crm_lead: over.leads ?? [lead(L.amara, S.newPnc, { stage_entered_at: "2026-09-01T09:00:00Z" })], crm_activity: [] },
    refuse: over.refuse,
  };
  const inner = keeperHandler(db);
  const handler = (q: Recorded) => {
    if (q.action === "update" && q.table === "crm_lead") over.beforeUpdate?.(db);
    return inner(q);
  };
  const { client, log } = fakeAdmin(handler);
  const actor: AgentActor = { kind: "agent", agent: "stage-keeper", admin: client as unknown as SupabaseClient, orgId: ORG };
  return { db, log, actor };
}

const request = (over: Partial<AgentMove> = {}): AgentMove => ({
  leadId: L.amara,
  fromStageId: S.newPnc,
  toStageId: S.loe,
  signalKey: `${L.amara}:mail:msg-1`,
  signalId: "loe-invoice-sent",
  evidence: MAIL_EVIDENCE,
  evidenceAt: "2026-09-20T10:00:00Z",
  now: NOW,
  ...over,
});

afterEach(() => vi.resetModules());

describe("F9 move semantics (agent)", () => {
  it("sets the stage, stamps stage_entered_at with the evidence date and last_activity_at with now", async () => {
    const { db, actor } = setup();
    const out = await moveLeadStageAs(actor, request());
    expect(out).toMatchObject({ ok: true, stageEnteredAt: "2026-09-20T10:00:00.000Z", previousStageEnteredAt: "2026-09-01T09:00:00Z" });
    expect(db.tables.crm_lead[0]).toMatchObject({
      current_stage_id: S.loe,
      stage_entered_at: "2026-09-20T10:00:00.000Z",
      last_activity_at: new Date(NOW).toISOString(),
    });
  });

  it("an unusable or future evidence date falls back to now", async () => {
    for (const evidenceAt of ["not a date", "2026-12-31T00:00:00Z", "2026-02-31", null]) {
      const { db, actor } = setup();
      await moveLeadStageAs(actor, request({ evidenceAt }));
      expect(db.tables.crm_lead[0].stage_entered_at, String(evidenceAt)).toBe(new Date(NOW).toISOString());
    }
  });

  it("writes the timeline row: ai actor, agent name, ids and names, signal key, previous date and the small evidence object", async () => {
    const { db, actor } = setup();
    await moveLeadStageAs(actor, request());
    const [row] = db.tables.crm_activity;
    expect(row).toMatchObject({ org_id: ORG, lead_id: L.amara, type: "stage_changed", actor_type: "ai", actor_id: null });
    expect(row.payload).toEqual({
      actor: "agent:stage-keeper",
      from_stage: "New PNC",
      to_stage: "LOE & Invoice Sent",
      from_stage_id: S.newPnc,
      to_stage_id: S.loe,
      signal_key: `${L.amara}:mail:msg-1`,
      signal: "loe-invoice-sent",
      previous_stage_entered_at: "2026-09-01T09:00:00Z",
      evidence: MAIL_EVIDENCE,
      evidence_at: "2026-09-20T10:00:00.000Z",
    });
  });

  it("a calendar move records the title and start only", async () => {
    const { db, actor } = setup();
    await moveLeadStageAs(actor, request({ toStageId: S.consult, signalId: "consult-scheduled", evidence: { kind: "calendar", title: "Strategy session", starts_at: "2026-09-28T15:00:00Z" }, evidenceAt: null }));
    expect(db.tables.crm_activity[0].payload.evidence).toEqual({ kind: "calendar", title: "Strategy session", starts_at: "2026-09-28T15:00:00Z" });
    expect(db.tables.crm_lead[0].stage_entered_at).toBe(new Date(NOW).toISOString());
  });

  it("never writes the lane columns, a matter, a sequence stop or an automation run", async () => {
    const { log, actor } = setup();
    await moveLeadStageAs(actor, request());
    const written = log.filter((q) => q.action !== "select");
    expect(written.map((q) => `${q.action} ${q.table}`)).toEqual(["update crm_lead", "insert crm_activity"]);
    expect(JSON.stringify(written.map((q) => q.values))).not.toMatch(/lane/);
    expect(log.some((q) => /matter|drip|rule|automation/.test(q.table))).toBe(false);
  });
});

describe("F4 / F10 refusals and the fence", () => {
  it("refuses a destination that is won, lost or nurture, on its own", async () => {
    for (const to of [S.signed, S.lost, S.nurture]) {
      const { db, actor } = setup();
      expect(await moveLeadStageAs(actor, request({ toStageId: to })), to).toEqual({ ok: false, reason: "refused" });
      expect(db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
      expect(db.tables.crm_activity).toEqual([]);
    }
  });

  it("refuses a destination that is not strictly forward", async () => {
    const { db, actor } = setup({ leads: [lead(L.amara, S.loe)] });
    expect(await moveLeadStageAs(actor, request({ fromStageId: S.loe, toStageId: S.consult }))).toEqual({ ok: false, reason: "refused" });
    expect(await moveLeadStageAs(actor, request({ fromStageId: S.loe, toStageId: S.loe }))).toEqual({ ok: false, reason: "refused" });
    expect(db.tables.crm_activity).toEqual([]);
  });

  it("refuses a destination in another firm: the stage is read with the org filter, so it is not there", async () => {
    const foreign = stageRows().map((s) => (s.id === S.loe ? { ...s, org_id: OTHER_ORG } : s));
    const { db, actor } = setup({ stages: foreign });
    expect(await moveLeadStageAs(actor, request())).toEqual({ ok: false, reason: "refused" });
    expect(db.tables.crm_activity).toEqual([]);
  });

  it("another firm's lead is never read or written", async () => {
    const { db, actor, log } = setup({ leads: [lead(L.other, S.newPnc, { org_id: OTHER_ORG })] });
    expect(await moveLeadStageAs(actor, request({ leadId: L.other }))).toEqual({ ok: false, reason: "not-found" });
    expect(db.tables.crm_lead[0].current_stage_id).toBe(S.newPnc);
    expect(log.some((q) => q.action === "update")).toBe(false);
  });

  it("every statement names the firm's org_id, the update included", async () => {
    const { log, actor } = setup();
    await moveLeadStageAs(actor, request());
    expect(() => assertOrgFenced(log)).not.toThrow();
    const update = log.find((q) => q.action === "update")!;
    expect(update.filters.map((f) => f.column).sort()).toEqual(["current_stage_id", "id", "org_id"]);
  });

  it("a lead that is no longer in the stage the decision was made from is left alone (a person's move wins)", async () => {
    const { db, actor } = setup({ leads: [lead(L.amara, S.pnc)] });
    expect(await moveLeadStageAs(actor, request())).toEqual({ ok: false, reason: "stale" });
    expect(db.tables.crm_lead[0].current_stage_id).toBe(S.pnc);
    expect(db.tables.crm_activity).toEqual([]);
  });

  it("a person who moves the lead between the read and the write wins: the conditional update matches nothing", async () => {
    const { db, actor } = setup({
      beforeUpdate: (d) => {
        d.tables.crm_lead[0].current_stage_id = S.pnc; // the person's move lands first
      },
    });
    expect(await moveLeadStageAs(actor, request())).toEqual({ ok: false, reason: "stale" });
    expect(db.tables.crm_lead[0].current_stage_id).toBe(S.pnc);
    expect(db.tables.crm_activity).toEqual([]);
  });

  it("if the timeline row cannot be written the lead goes back, because a move nobody can see is worse than none", async () => {
    const { db, actor } = setup({ refuse: (q) => (q.table === "crm_activity" && q.action === "insert" ? { message: "boom" } : undefined) });
    expect(await moveLeadStageAs(actor, request())).toEqual({ ok: false, reason: "error" });
    expect(db.tables.crm_lead[0]).toMatchObject({ current_stage_id: S.newPnc, stage_entered_at: "2026-09-01T09:00:00Z" });
  });

  it("a failed read is an error, not a quiet success", async () => {
    const { actor } = setup({ refuse: (q) => (q.table === "crm_stage" ? { message: "boom" } : undefined) });
    expect(await moveLeadStageAs(actor, request())).toEqual({ ok: false, reason: "error" });
  });

  it("the sentinel planted around the move is not in anything written", async () => {
    const { log, actor } = setup({ leads: [lead(L.amara, S.newPnc, { notes: SENTINEL, email: `${SENTINEL}@x.test` })] });
    await moveLeadStageAs(actor, request());
    expect(JSON.stringify(log.filter((q) => q.action !== "select").map((q) => q.values))).not.toContain(SENTINEL);
  });
});

describe("the person path", () => {
  it("delegates to the existing moveLeadStage, with the evidence date and the extra payload", async () => {
    const moveLeadStage = vi.fn(async () => ({ id: L.amara }));
    vi.doMock("@/lib/pipeline/leads", () => ({ moveLeadStage }));
    const { moveLeadStageAs: move } = await import("../../src/lib/pipeline/move-as");
    const out = await move({ kind: "person" }, { leadId: L.amara, toStageId: S.pnc, evidenceAt: "2026-09-01T00:00:00Z", extraPayload: { undoes_activity_id: "a1" } });
    expect(out).toMatchObject({ ok: true });
    expect(moveLeadStage).toHaveBeenCalledWith(L.amara, S.pnc, "2026-09-01T00:00:00Z", { undoes_activity_id: "a1" });
    vi.doUnmock("@/lib/pipeline/leads");
  });

  it("lets a refusal from the role gate through unchanged", async () => {
    vi.doMock("@/lib/pipeline/leads", () => ({
      moveLeadStage: vi.fn(async () => {
        throw new Error("Forbidden: paralegal may not move lead stage");
      }),
    }));
    const { moveLeadStageAs: move } = await import("../../src/lib/pipeline/move-as");
    await expect(move({ kind: "person" }, { leadId: L.amara, toStageId: S.pnc })).rejects.toThrow(/Forbidden/);
    vi.doUnmock("@/lib/pipeline/leads");
  });
});
