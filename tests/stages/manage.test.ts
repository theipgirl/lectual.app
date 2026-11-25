import { describe, expect, it, vi } from "vitest";
import { changeStage, placeBeside, orderedIds, stopInChunks, MAX_DELETE_IDS, type ManagedStage, type StageDeps } from "@/lib/stages/manage";
import { stageErrorSentence, isStageFunctionMissing } from "@/lib/stages/errors";
import * as W from "@/lib/ui/words";

/**
 * The owner's stage menu (spec-editable-views.md 3b): every operation is one lectual 0119 function call, made only for an owner
 * membership row, with positions worked out on the server from the firm's own stage list, the delete dialog's ids passed through,
 * one retry on a lock error, fixed sentences, and the same sequence stop a person's move would run.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD: ManagedStage[] = [
  { id: id(1), name: "New", order_index: 10, category: "open" },
  { id: id(2), name: "Consult", order_index: 20, category: "open" },
  { id: id(3), name: "Hired", order_index: 30, category: "won" },
  { id: id(4), name: "Signed", order_index: 40, category: "won" },
  { id: id(5), name: "Lost", order_index: 50, category: "lost" },
];

function make(over: Partial<StageDeps> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const stops: Array<{ ids: string[]; dest: string }> = [];
  const deps: StageDeps = {
    owner: async () => "owner",
    readStages: async () => LEAD,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
    stopSequences: async (ids, dest) => (stops.push({ ids, dest: dest.id }), true),
    revalidate: vi.fn(),
    ...over,
  };
  return { deps, calls, stops };
}

describe("who", () => {
  it.each(["not-owner", "unreadable"] as const)("%s: refused before any read or call", async (state) => {
    const readStages = vi.fn();
    const { deps, calls } = make({ owner: async () => state, readStages });
    expect(await changeStage(deps, "lead", { op: "rename", stageId: id(1), name: "X" })).toEqual({ ok: false, error: W.STAGE_OWNER_ONLY });
    expect(calls).toEqual([]);
    expect(readStages).not.toHaveBeenCalled();
  });
  it("an owner check that throws is no", async () => {
    const { deps, calls } = make({ owner: async () => Promise.reject(new Error("x")) });
    expect((await changeStage(deps, "lead", { op: "rename", stageId: id(1), name: "X" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("positions come from the server's own read", () => {
  it("placeBeside: move and add", () => {
    const ids = orderedIds(LEAD);
    expect(ids).toEqual([id(1), id(2), id(3), id(4), id(5)]);
    // Move Lost left of Consult: list without Lost, before Consult = 1.
    expect(placeBeside(ids, id(2), "left", id(5))).toBe(1);
    // Move New right of Consult: without New, Consult at 0, right = 1.
    expect(placeBeside(ids, id(2), "right", id(1))).toBe(1);
    // Add right of Hired: whole list, Hired at 2 -> 3.
    expect(placeBeside(ids, id(3), "right")).toBe(3);
    expect(placeBeside(ids, id(9), "right")).toBeNull();
  });
  it("move sends the computed position; a neighbour gone is refused before the call", async () => {
    const { deps, calls } = make();
    expect(await changeStage(deps, "lead", { op: "move", stageId: id(5), beside: id(2), side: "left" })).toEqual({ ok: true });
    expect(calls).toEqual([{ fn: "crm_stage_move", args: { p_stage: id(5), p_position: 1 } }]);
    const again = make();
    expect(await changeStage(again.deps, "lead", { op: "move", stageId: id(5), beside: id(9), side: "left" })).toEqual({ ok: false, error: W.STAGE_PLACE_GONE });
    expect(again.calls).toEqual([]);
  });
  it("a stage list that can't be read changes nothing", async () => {
    const { deps, calls } = make({ readStages: async () => null });
    expect((await changeStage(deps, "lead", { op: "add", beside: id(2), side: "left", name: "X" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("each operation names its function", () => {
  it("lead add, rename, category", async () => {
    const { deps, calls } = make();
    await changeStage(deps, "lead", { op: "add", beside: id(2), side: "right", name: "  Proposal out ", category: "open" });
    await changeStage(deps, "lead", { op: "rename", stageId: id(2), name: "Consult booked" });
    await changeStage(deps, "lead", { op: "category", stageId: id(2), category: "nurture" });
    expect(calls).toEqual([
      { fn: "crm_stage_add", args: { p_name: "Proposal out", p_position: 2, p_category: "open" } },
      { fn: "crm_stage_rename", args: { p_stage: id(2), p_name: "Consult booked" } },
      { fn: "crm_stage_set_category", args: { p_stage: id(2), p_category: "nurture", p_confirm_no_won: false } },
    ]);
  });
  it("matter add takes the neighbour's phase, open/closed and who it waits on", async () => {
    const matter: ManagedStage[] = [
      { id: id(11), name: "Drafting", order_index: 1, is_open: true, phase: "pre_filing" },
      { id: id(12), name: "Filed", order_index: 2, is_open: true, phase: "post_filing" },
    ];
    const { deps, calls } = make({ readStages: async () => matter });
    await changeStage(deps, "matter", { op: "add", beside: id(11), side: "right", name: "Review", isOpen: true, waitingOn: "client" });
    await changeStage(deps, "matter", { op: "open", stageId: id(12), isOpen: false });
    expect(calls).toEqual([
      { fn: "crm_matter_stage_add", args: { p_label: "Review", p_position: 1, p_is_open: true, p_waiting_on: "client", p_phase: "pre_filing" } },
      { fn: "crm_matter_stage_set_open", args: { p_stage: id(12), p_is_open: false } },
    ]);
  });
  it("bad input is refused before any call", async () => {
    const { deps, calls } = make();
    expect((await changeStage(deps, "lead", { op: "add", beside: id(2), side: "right", name: "X", category: "maybe" })).ok).toBe(false);
    expect((await changeStage(deps, "lead", { op: "rename", stageId: "nope", name: "X" })).ok).toBe(false);
    expect((await changeStage(deps, "lead", { op: "rename", stageId: id(1), name: "   " })).ok).toBe(false);
    expect((await changeStage(deps, "lead", { op: "rename", stageId: id(1), name: "x".repeat(81) })).ok).toBe(false);
    expect((await changeStage(deps, "matter", { op: "category", stageId: id(1), category: "won" })).ok).toBe(false);
    expect((await changeStage(deps, "other", { op: "rename", stageId: id(1), name: "X" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("delete", () => {
  it("passes the dialog's ids, destination and role through unchanged", async () => {
    const { deps, calls } = make();
    await changeStage(deps, "lead", { op: "delete", stageId: id(2), destination: id(1), expectedIds: [id(21), id(22)], roleTo: null });
    expect(calls[0]).toEqual({ fn: "crm_stage_delete", args: { p_stage: id(2), p_destination: id(1), p_expected_ids: [id(21), id(22)], p_role_to: null, p_confirm_no_won: false } });
  });
  it("records changed since the dialog opened: the fixed sentence", async () => {
    const { deps } = make({ rpc: async () => ({ data: null, error: { code: "P0001", message: "stage_delete_records_changed: the leads in this stage changed" } }) });
    expect(await changeStage(deps, "lead", { op: "delete", stageId: id(2), destination: id(1), expectedIds: [] })).toEqual({ ok: false, error: W.STAGE_RECORDS_CHANGED });
  });
  it("moved into a won stage: the moved leads' sequences stop, as a person's move would", async () => {
    const { deps, stops } = make({ rpc: async () => ({ data: { destination: id(4), moved_ids: [id(21)] }, error: null }) });
    expect(await changeStage(deps, "lead", { op: "delete", stageId: id(3), destination: id(4), expectedIds: [id(21)] })).toEqual({ ok: true });
    expect(stops).toEqual([{ ids: [id(21)], dest: id(4) }]);
  });
  it("a sequence stop that didn't finish is said, the delete still stands", async () => {
    const { deps } = make({ rpc: async () => ({ data: { destination: id(4), moved_ids: [id(21)] }, error: null }), stopSequences: async () => false });
    expect(await changeStage(deps, "lead", { op: "delete", stageId: id(3), destination: id(4), expectedIds: [id(21)] })).toEqual({ ok: true, note: W.STAGE_DELETED_SEQUENCES_NOTE });
  });
  it("no automation rule is run: the dependencies have no rule runner at all", () => {
    const { deps } = make();
    expect(Object.keys(deps).sort()).toEqual(["owner", "readStages", "revalidate", "rpc", "stopSequences"]);
  });
  it("matter delete sends p_confirm_open_change, never a lead flag", async () => {
    const { deps, calls } = make({ readStages: async () => [] });
    await changeStage(deps, "matter", { op: "delete", stageId: id(11), destination: id(12), expectedIds: [id(31)], confirmOpenChange: true });
    expect(calls[0].args).toEqual({ p_stage: id(11), p_destination: id(12), p_expected_ids: [id(31)], p_role_to: null, p_confirm_open_change: true });
  });
  it("more ids than one delete takes: its own sentence, no call", async () => {
    const { deps, calls } = make();
    const many = Array.from({ length: MAX_DELETE_IDS + 1 }, (_, i) => id(1000 + i));
    expect(await changeStage(deps, "lead", { op: "delete", stageId: id(2), destination: id(1), expectedIds: many })).toEqual({ ok: false, error: W.STAGE_TOO_MANY_RECORDS });
    expect(calls).toEqual([]);
  });
  it("sequence stops go in chunks of 80; ok only when every chunk is", async () => {
    const ids = Array.from({ length: 170 }, (_, i) => id(2000 + i));
    const seen: number[] = [];
    expect(await stopInChunks(ids, async (c) => (seen.push(c.length), true))).toBe(true);
    expect(seen).toEqual([80, 80, 10]);
    let n = 0;
    const tried: number[] = [];
    expect(await stopInChunks(ids, async (c) => (tried.push(c.length), n++ !== 1))).toBe(false);
    expect(tried).toEqual([80, 80, 10]);
    expect(await stopInChunks(ids, async () => Promise.reject(new Error("x")))).toBe(false);
  });
  it("ids that aren't ids are refused before the call", async () => {
    const { deps, calls } = make();
    expect((await changeStage(deps, "lead", { op: "delete", stageId: id(2), destination: id(1), expectedIds: ["x"] })).ok).toBe(false);
    expect((await changeStage(deps, "lead", { op: "delete", stageId: id(2), destination: id(1) })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("errors", () => {
  it("not set up: the plain sentence, by code", async () => {
    for (const code of ["PGRST202", "42883"]) {
      expect(isStageFunctionMissing({ code })).toBe(true);
      const { deps } = make({ rpc: async () => ({ data: null, error: { code, message: "anything" } }) });
      expect(await changeStage(deps, "lead", { op: "rename", stageId: id(1), name: "X" })).toEqual({ ok: false, error: W.STAGES_NOT_READY });
    }
    expect(W.STAGES_NOT_READY).toBe(W.notReadyYet("Changing stages"));
  });
  it("a deadlock is retried once, then the busy sentence", async () => {
    let n = 0;
    const ok = make({ rpc: async () => (n++ === 0 ? { data: null, error: { code: "40P01" } } : { data: null, error: null }) });
    expect(await changeStage(ok.deps, "lead", { op: "rename", stageId: id(1), name: "X" })).toEqual({ ok: true });
    expect(n).toBe(2);
    let m = 0;
    const busy = make({ rpc: async () => (m++, { data: null, error: { code: "55P03" } }) });
    expect(await changeStage(busy.deps, "lead", { op: "rename", stageId: id(1), name: "X" })).toEqual({ ok: false, error: W.STAGE_BUSY });
    expect(m).toBe(2);
  });
  it("every 0119 prefix maps to a fixed sentence, never the database text", () => {
    const prefixes = [
      "stage_not_owner", "stage_not_found", "stage_delete_bad_destination", "stage_role_guarded", "stage_owner_only", "stage_name_taken", "stage_bad_name",
      "stage_bad_position", "stage_bad_category", "stage_delete_bad_ids", "stage_delete_needs_destination", "stage_delete_same_stage", "matter_stage_bad_waiting_on",
      "stage_limit", "stage_order_overflow", "stage_not_empty", "stage_last_open", "stage_last_won", "stage_holds_role", "stage_role_taken",
      "stage_role_category_mismatch", "stage_role_delete", "stage_delete_records_changed", "stage_delete_won_destination", "stage_delete_won_source", "stage_delete_open_mismatch",
      "matter_stage_bad_phase", "matter_stage_phase_unavailable",
    ];
    for (const p of prefixes) {
      const s = stageErrorSentence({ code: "23514", message: `${p}: secret database words` });
      expect(s, p).not.toBe(W.STAGE_CHANGE_FAILED);
      expect(s).not.toContain("secret");
    }
    expect(stageErrorSentence({ code: "XX000", message: "boom" })).toBe(W.STAGE_CHANGE_FAILED);
    expect(stageErrorSentence({ code: "23503", message: "fk" })).toBe(W.STAGE_RECORDS_CHANGED);
    expect(stageErrorSentence({ message: "stage_bad_category: x" }, "matter")).toBe(W.STAGE_BAD_OPEN);
  });
});
