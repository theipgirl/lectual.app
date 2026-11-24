import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeAdmin } from "../mailbox/fake-db";
import { keeperHandler, lead, stageRows, type KeeperDb } from "../stage-keeper/db";
import { L, ORG, S } from "../stage-keeper/fixtures";

/**
 * The stage-entry hook: both move paths call it, and it never fails, delays or changes the move.
 */
const state = vi.hoisted(() => ({
  hook: vi.fn(),
  hookThrows: false,
  role: "attorney" as string | null,
  afterCallbacks: [] as Array<() => unknown>,
  afterThrows: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/consult-prep/hook", () => ({
  scheduleConsultPrepOnEntry: (move: unknown) => {
    state.hook(move);
    if (state.hookThrows) throw new Error("hook exploded: planted-secret");
  },
}));

class Q implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private result: { data: unknown; error: unknown }) {}
  select() { return this; }
  eq() { return this; }
  is() { return this; }
  in() { return this; }
  update() { return this; }
  insert() { return this; }
  limit() { return this; }
  order() { return this; }
  single() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.result).then(ok, bad);
  }
}
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: () => new Q({ data: { id: "lead-1", current_stage_id: "stage-consult", category: "open" }, error: null }),
    rpc: async (fn: string) => ({ data: fn === "current_org_id" ? "org-1" : state.role, error: null }),
  })),
}));
vi.mock("@/lib/matters", () => ({ ensureMatterForLead: vi.fn(), logActivitySafe: vi.fn(async () => {}) }));
vi.mock("@/lib/automation", () => ({ runRules: vi.fn(async () => {}) }));

afterEach(() => {
  vi.clearAllMocks();
  state.hookThrows = false;
});

describe("a person's move calls the hook, and a hook failure never fails the move", () => {
  it("calls it once with the lead and the stage moved to", async () => {
    const { moveLeadStage } = await import("@/lib/pipeline/leads");
    const lead = await moveLeadStage("lead-1", "stage-consult");
    expect(lead).toMatchObject({ id: "lead-1" });
    expect(state.hook).toHaveBeenCalledTimes(1);
    expect(state.hook).toHaveBeenCalledWith({ leadId: "lead-1", toStageId: "stage-consult" });
  });

  it("a refused role moves nothing and starts nothing", async () => {
    state.role = "viewer";
    const { moveLeadStage } = await import("@/lib/pipeline/leads");
    await expect(moveLeadStage("lead-1", "stage-consult")).rejects.toThrow(/Forbidden/);
    expect(state.hook).not.toHaveBeenCalled();
    state.role = "attorney";
  });

  it("a hook that throws is swallowed: the move returns the lead", async () => {
    state.hookThrows = true;
    const { moveLeadStage } = await import("@/lib/pipeline/leads");
    await expect(moveLeadStage("lead-1", "stage-consult")).resolves.toMatchObject({ id: "lead-1" });
    expect(state.hook).toHaveBeenCalledTimes(1);
  });
});

describe("the Stage Keeper's move calls the same hook", () => {
  function actor(over: { staleStage?: boolean } = {}) {
    const db: KeeperDb = {
      tables: { crm_stage: stageRows(), crm_lead: [lead(L.amara, over.staleStage ? S.loe : S.newPnc, { stage_entered_at: "2026-09-01T09:00:00Z" })], crm_activity: [] },
    };
    const { client } = fakeAdmin(keeperHandler(db));
    return { kind: "agent", agent: "stage-keeper", admin: client as unknown as SupabaseClient, orgId: ORG } as const;
  }
  const move = { leadId: L.amara, fromStageId: S.newPnc, toStageId: S.loe, signalKey: "k", signalId: "loe-invoice-sent" as const, evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-09-20T10:00:00Z", subject: "Your engagement letter" } as const, evidenceAt: "2026-09-20T10:00:00Z" };

  it("calls the hook after the move landed", async () => {
    const { moveLeadStageAs } = await import("@/lib/pipeline/move-as");
    const out = await moveLeadStageAs(actor(), move);
    expect(out).toMatchObject({ ok: true });
    expect(state.hook).toHaveBeenCalledWith({ leadId: L.amara, toStageId: S.loe });
  });

  it("calls nothing when the move is refused (the lead was moved by someone else)", async () => {
    const { moveLeadStageAs } = await import("@/lib/pipeline/move-as");
    const out = await moveLeadStageAs(actor({ staleStage: true }), move);
    expect(out).toMatchObject({ ok: false, reason: "stale" });
    expect(state.hook).not.toHaveBeenCalled();
  });

  it("a hook that throws does not change the outcome of the move", async () => {
    state.hookThrows = true;
    const { moveLeadStageAs } = await import("@/lib/pipeline/move-as");
    const out = await moveLeadStageAs(actor(), move);
    expect(out).toMatchObject({ ok: true });
  });
});
