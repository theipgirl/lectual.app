import { describe, it, expect, vi, beforeEach } from "vitest";
import { BULK_MESSAGES, BULK_MOVE_MAX, bulkMoveSummary, parseLeadIds, runBulkMove, type BulkMoveDeps } from "@/lib/pipeline/bulk-move";

/** Sprint 29 F: the rules of "Move to..." for several leads, over fakes. */

const id = (n: number) => `1ead0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STAGE = "5a000000-0000-4000-8000-000000000005";
const WON = "5a000000-0000-4000-8000-000000000008";
const FROM = "5a000000-0000-4000-8000-000000000001";

function deps(over: Partial<BulkMoveDeps> & { leads?: Array<{ id: string; current_stage_id: string }> } = {}) {
  const leads = over.leads ?? [1, 2, 3].map((n) => ({ id: id(n), current_stage_id: FROM }));
  const moved: Array<[string, string]> = [];
  const made: BulkMoveDeps = {
    canMove: async () => true,
    readStage: async (stageId) => (stageId === STAGE ? { id: STAGE, category: "open" } : stageId === WON ? { id: WON, category: "won" } : null),
    readLeads: async (ids) => leads.filter((l) => ids.includes(l.id)),
    move: async (leadId, stageId) => {
      moved.push([leadId, stageId]);
    },
    explain: () => "Couldn't move this lead. Please try again.",
    ...over,
  };
  return { made, moved };
}

describe("runBulkMove", () => {
  it("moves each lead through the per-lead move, in order, and reports what moved", async () => {
    const { made, moved } = deps();
    const result = await runBulkMove({ leadIds: [id(1), id(2), id(3)], stageId: STAGE }, made);
    expect(result).toEqual({ ok: true, stageId: STAGE, moved: [id(1), id(2), id(3)], skipped: [], failed: [] });
    expect(moved).toEqual([[id(1), STAGE], [id(2), STAGE], [id(3), STAGE]]);
  });

  it("refuses a won stage and writes nothing", async () => {
    const { made, moved } = deps();
    expect(await runBulkMove({ leadIds: [id(1)], stageId: WON }, made)).toEqual({ ok: false, error: BULK_MESSAGES.stageWon });
    expect(moved).toEqual([]);
  });

  it("refuses a stage that is not the firm's (the scoped read finds nothing)", async () => {
    const { made, moved } = deps();
    expect(await runBulkMove({ leadIds: [id(1)], stageId: "5a000000-0000-4000-8000-0000000000ff" }, made)).toEqual({ ok: false, error: BULK_MESSAGES.stageMissing });
    expect(moved).toEqual([]);
  });

  it("caps a request at 200 leads: exactly 200 goes, 201 is refused with nothing written", async () => {
    const many = Array.from({ length: BULK_MOVE_MAX + 1 }, (_, n) => id(n + 1));
    const { made, moved } = deps({ leads: many.map((l) => ({ id: l, current_stage_id: FROM })) });
    expect(await runBulkMove({ leadIds: many, stageId: STAGE }, made)).toEqual({ ok: false, error: BULK_MESSAGES.tooMany });
    expect(moved).toEqual([]);
    const ok = await runBulkMove({ leadIds: many.slice(0, BULK_MOVE_MAX), stageId: STAGE }, made);
    expect(ok.ok && ok.moved).toHaveLength(BULK_MOVE_MAX);
  });

  it("re-resolves the role: a role that cannot move stages reads and writes nothing", async () => {
    const readStage = vi.fn();
    const readLeads = vi.fn();
    const { made, moved } = deps({ canMove: async () => false, readStage, readLeads });
    expect(await runBulkMove({ leadIds: [id(1)], stageId: STAGE }, made)).toEqual({ ok: false, error: BULK_MESSAGES.forbidden });
    expect(readStage).not.toHaveBeenCalled();
    expect(readLeads).not.toHaveBeenCalled();
    expect(moved).toEqual([]);
    // A role lookup that throws is a refusal too.
    expect(await runBulkMove({ leadIds: [id(1)], stageId: STAGE }, deps({ canMove: async () => { throw new Error("rpc"); } }).made)).toEqual({ ok: false, error: BULK_MESSAGES.forbidden });
  });

  it("a lead the scoped read cannot see (another firm's, or gone) is reported by itself and never moved", async () => {
    const { made, moved } = deps({ leads: [{ id: id(1), current_stage_id: FROM }] });
    const result = await runBulkMove({ leadIds: [id(1), id(2)], stageId: STAGE }, made);
    expect(result).toEqual({ ok: true, stageId: STAGE, moved: [id(1)], skipped: [], failed: [{ leadId: id(2), error: BULK_MESSAGES.leadMissing }] });
    expect(moved).toEqual([[id(1), STAGE]]);
  });

  it("a partial failure reports per lead and the rest still move", async () => {
    const calls: string[] = [];
    const { made } = deps({
      move: async (leadId) => {
        calls.push(leadId);
        if (leadId === id(2)) throw new Error("RLS said no: secret detail");
      },
      explain: (err) => (String((err as Error).message).includes("RLS") ? "You don't have permission to move this lead to that stage." : "x"),
    });
    const result = await runBulkMove({ leadIds: [id(1), id(2), id(3)], stageId: STAGE }, made);
    expect(calls).toEqual([id(1), id(2), id(3)]);
    expect(result).toEqual({
      ok: true,
      stageId: STAGE,
      moved: [id(1), id(3)],
      skipped: [],
      failed: [{ leadId: id(2), error: "You don't have permission to move this lead to that stage." }],
    });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });

  it("a lead already in the stage is skipped, not rewritten", async () => {
    const { made, moved } = deps({ leads: [{ id: id(1), current_stage_id: STAGE }, { id: id(2), current_stage_id: FROM }] });
    const result = await runBulkMove({ leadIds: [id(1), id(2)], stageId: STAGE }, made);
    expect(result).toMatchObject({ ok: true, moved: [id(2)], skipped: [id(1)] });
    expect(moved).toEqual([[id(2), STAGE]]);
  });

  it("an unreadable lead or stage read is 'Nothing was moved', never a partial guess", async () => {
    const a = deps({ readLeads: async () => { throw new Error("down"); } });
    expect(await runBulkMove({ leadIds: [id(1)], stageId: STAGE }, a.made)).toEqual({ ok: false, error: BULK_MESSAGES.unreadable });
    expect(a.moved).toEqual([]);
    const b = deps({ readStage: async () => { throw new Error("down"); } });
    expect(await runBulkMove({ leadIds: [id(1)], stageId: STAGE }, b.made)).toEqual({ ok: false, error: BULK_MESSAGES.unreadable });
  });

  it("refuses a request that is not a list of ids, or has no stage", async () => {
    const { made, moved } = deps();
    for (const leadIds of [undefined, "x", [], [""], [id(1), 7], ["not-an-id"]]) {
      expect((await runBulkMove({ leadIds, stageId: STAGE }, made)).ok).toBe(false);
    }
    expect(await runBulkMove({ leadIds: [id(1)], stageId: "" }, made)).toEqual({ ok: false, error: BULK_MESSAGES.noStage });
    expect(await runBulkMove({ leadIds: [id(1)], stageId: 5 }, made)).toEqual({ ok: false, error: BULK_MESSAGES.noStage });
    expect(moved).toEqual([]);
  });

  it("de-duplicates ids before counting and moving", async () => {
    expect(parseLeadIds([id(1), id(1).toUpperCase(), id(2)])).toEqual([id(1), id(2)]);
    const { made, moved } = deps();
    await runBulkMove({ leadIds: [id(1), id(1)], stageId: STAGE }, made);
    expect(moved).toEqual([[id(1), STAGE]]);
  });

  it("the summary names counts only", () => {
    expect(bulkMoveSummary("3 · Post", { ok: true, stageId: STAGE, moved: [id(1)], skipped: [id(2), id(3)], failed: [{ leadId: id(4), error: "x" }] })).toBe(
      "Moved 1 lead to 3 · Post. 2 leads already there. 1 lead couldn't be moved; the reason is on each card.",
    );
  });
});

describe("the server action wires the real reads and moves", () => {
  const state = vi.hoisted(() => ({
    role: "attorney" as string,
    stage: { id: "5a000000-0000-4000-8000-000000000005", category: "open" } as { id: string; category: string } | null,
    leads: [] as Array<{ id: string; current_stage_id: string }>,
    moves: [] as Array<[string, string]>,
    froms: [] as string[],
    failOn: null as string | null,
  }));

  beforeEach(() => {
    vi.resetModules();
    state.role = "attorney";
    state.moves = [];
    state.froms = [];
    state.failOn = null;
    state.stage = { id: STAGE, category: "open" };
    state.leads = [1, 2].map((n) => ({ id: id(n), current_stage_id: FROM }));
  });

  async function load() {
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({
        rpc: async (fn: string) => ({ data: fn === "current_org_role" ? state.role : null, error: null }),
        from: (table: string) => {
          state.froms.push(table);
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: state.stage, error: null }) }),
              in: async (_c: string, ids: string[]) => ({ data: state.leads.filter((l) => ids.includes(l.id)), error: null }),
            }),
          };
        },
      }),
    }));
    vi.doMock("@/lib/pipeline", () => ({
      assignLead: vi.fn(),
      moveLeadStage: async (leadId: string, stageId: string) => {
        if (leadId === state.failOn) throw new Error("boom");
        state.moves.push([leadId, stageId]);
      },
    }));
    vi.doMock("@/lib/intake/leads", () => ({ setLane: vi.fn(), setReferralSource: vi.fn() }));
    return import("@/app/dashboard/intake/actions");
  }

  it("moves through moveLeadStage with the scoped client's reads", async () => {
    const { bulkMoveStageAction } = await load();
    const result = await bulkMoveStageAction([id(1), id(2)], STAGE);
    expect(result).toMatchObject({ ok: true, moved: [id(1), id(2)] });
    expect(state.moves).toEqual([[id(1), STAGE], [id(2), STAGE]]);
    expect([...new Set(state.froms)].sort()).toEqual(["crm_lead", "crm_stage"]);
  });

  it("a viewer is refused before anything is read, and a won stage is refused by the live stage list", async () => {
    const { bulkMoveStageAction } = await load();
    state.role = "viewer";
    expect(await bulkMoveStageAction([id(1)], STAGE)).toEqual({ ok: false, error: BULK_MESSAGES.forbidden });
    expect(state.froms).toEqual([]);
    state.role = "attorney";
    state.stage = { id: STAGE, category: "won" };
    expect(await bulkMoveStageAction([id(1)], STAGE)).toEqual({ ok: false, error: BULK_MESSAGES.stageWon });
    expect(state.moves).toEqual([]);
  });

  it("a failing lead is explained with a fixed sentence, not the raw error", async () => {
    const { bulkMoveStageAction } = await load();
    state.failOn = id(1);
    const result = await bulkMoveStageAction([id(1), id(2)], STAGE);
    expect(result).toMatchObject({ ok: true, moved: [id(2)], failed: [{ leadId: id(1), error: "Couldn't move this lead. Please try again." }] });
  });
});
