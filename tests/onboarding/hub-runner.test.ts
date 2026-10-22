import { describe, expect, it } from "vitest";
import { visibleFlows, type HubFlow } from "@/lib/onboarding/hub";
import {
  HUB_FLOW_KEY,
  HUB_LOCAL_DONE_KEY,
  HUB_RECORDS_KEY,
  NO_RECORDS,
  advanceFlow,
  afterFinish,
  clearFlow,
  decodeRecords,
  encodeFlowState,
  encodeRecords,
  flowNeedsRecords,
  leftFlowPage,
  moveTo,
  readLocalDone,
  resumeFlow,
  startFlow,
  stepView,
  storeStart,
  toTourStep,
  writeLocalDone,
  type StorageLike,
} from "@/lib/onboarding/hub-runner";

const flows = visibleFlows({ role: "owner", modules: ["proposals", "agents", "agent-toolkit", "mailbox"], aiConfigured: true });
const byId = (id: string): HubFlow => flows.find((f) => f.id === id)!;
const RECORDS = { lead: "lead-1", matter: "matter-1", failed: false };

/** A multi-page flow: board on the Intake page, then a lead's page. */
const lead = byId("intake-lead");
const queue = byId("approvals-queue");

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("starting", () => {
  it("returns the first step, its page and the stored state", () => {
    const move = startFlow(byId("intake-leads"), NO_RECORDS, null);
    expect(move.index).toBe(0);
    expect(move.view.path).toBe("/dashboard/intake/");
    expect(move.view.target).toBe("nav-intake");
    expect(move.navigate).toBe("/dashboard/intake/");
    expect(move.state).toBe("intake-leads:0");
  });

  it("does not navigate when already on the page", () => {
    expect(startFlow(byId("intake-leads"), NO_RECORDS, "/dashboard/intake").navigate).toBeNull();
  });

  it("stores the flow and the records it starts with", () => {
    const store = memory();
    storeStart(store, lead, RECORDS);
    expect(store.getItem(HUB_FLOW_KEY)).toBe("intake-lead:0");
    expect(decodeRecords(store.getItem(HUB_RECORDS_KEY))).toEqual(RECORDS);
    clearFlow(store);
    expect(store.data.size).toBe(0);
  });

  it("knows which flows need a lead or matter picked", () => {
    expect(flowNeedsRecords(lead)).toBe(true);
    expect(flowNeedsRecords(byId("intake-leads"))).toBe(false);
  });
});

describe("moving between pages", () => {
  it("Next to a step on another page asks for navigation and stores flowId:index", () => {
    // A synthetic two-page flow: the catalog's step order is page A then page B.
    const flow: HubFlow = { ...queue, steps: [queue.steps[0], { ...lead.steps[0] }] };
    const next = advanceFlow(flow, 0, "next", RECORDS, "/dashboard/queue/");
    expect(next.kind).toBe("move");
    if (next.kind !== "move") return;
    expect(next.move.index).toBe(1);
    expect(next.move.navigate).toBe("/dashboard/leads/lead-1/");
    expect(next.move.state).toBe("approvals-queue:1");
  });

  it("Next within one page does not navigate", () => {
    const next = advanceFlow(queue, 0, "next", NO_RECORDS, "/dashboard/queue/");
    expect(next.kind === "move" && next.move.navigate).toBeNull();
  });

  it("Back from the first step of page B returns to the last step of page A, with navigation", () => {
    const flow: HubFlow = { ...queue, steps: [queue.steps[0], queue.steps[1], { ...lead.steps[0] }] };
    const back = advanceFlow(flow, 2, "back", RECORDS, "/dashboard/leads/lead-1/");
    expect(back.kind).toBe("move");
    if (back.kind !== "move") return;
    expect(back.move.index).toBe(1);
    expect(back.move.view.path).toBe("/dashboard/queue/");
    expect(back.move.navigate).toBe("/dashboard/queue/");
    expect(back.move.state).toBe("approvals-queue:1");
  });

  it("Back on the first step stays put", () => {
    const back = advanceFlow(queue, 0, "back", NO_RECORDS, "/dashboard/queue/");
    expect(back.kind === "move" && back.move.index).toBe(0);
  });

  it("moveTo clamps a wild index", () => {
    expect(moveTo(queue, 99, NO_RECORDS, null).index).toBe(queue.steps.length - 1);
    expect(moveTo(queue, -4, NO_RECORDS, null).index).toBe(0);
    expect(moveTo(queue, Number.NaN, NO_RECORDS, null).index).toBe(0);
  });
});

describe("ending", () => {
  it("Skip ends as skipped and marks nothing", () => {
    expect(advanceFlow(queue, 0, "skip", NO_RECORDS, null)).toEqual({ kind: "end", outcome: "skipped", markDone: null });
  });

  it("Next on the last step finishes and marks the flow done", () => {
    const last = queue.steps.length - 1;
    expect(advanceFlow(queue, last, "next", NO_RECORDS, null)).toEqual({ kind: "end", outcome: "finished", markDone: "approvals-queue" });
  });

  it("leaving the page by hand ends the flow, but arriving by our own navigation does not", () => {
    const view = stepView(queue.steps[0], NO_RECORDS);
    expect(leftFlowPage("/dashboard/queue", view, false)).toBe(false);
    expect(leftFlowPage("/dashboard/matters/", view, false)).toBe(true);
    expect(leftFlowPage("/dashboard/matters/", view, true)).toBe(false);
  });
});

describe("resuming from sessionStorage", () => {
  it("resumes a valid value", () => {
    const r = resumeFlow(encodeFlowState("intake-lead", 1), flows);
    expect(r.kind).toBe("resume");
    if (r.kind === "resume") expect(r.index).toBe(1);
  });

  it.each([null, undefined, "", "garbage", ":3", "no-such-flow:0", "intake-lead", "bogus:1"])("clears for the malformed or unknown value %j", (raw) => {
    expect(resumeFlow(raw as string | null, flows)).toEqual({ kind: "none" });
  });

  it.each(["intake-lead:9", "intake-lead:-1", "intake-lead:1.5", "intake-lead:abc", "intake-lead:99999"])("restarts a known flow for the index in %j", (raw) => {
    const r = resumeFlow(raw, flows);
    expect(r.kind).toBe("restart");
  });

  it("clears for a flow the person can no longer see", () => {
    const viewerFlows = visibleFlows({ role: "viewer", modules: [], aiConfigured: false });
    expect(resumeFlow("intake-reconcile:0", viewerFlows)).toEqual({ kind: "none" });
    expect(resumeFlow("intake-lead:0", viewerFlows).kind).toBe("resume");
  });
});

describe("record steps", () => {
  it("with a record resolves the path with that record's id only", () => {
    const view = stepView(lead.steps[0], { lead: "abc-123", matter: null, failed: false });
    expect(view.path).toBe("/dashboard/leads/abc-123/");
    expect(view.centered).toBe(false);
    expect(view.target).toBe("lead-head");
  });

  it("without a record becomes a centered card saying what the page shows", () => {
    const view = stepView(lead.steps[0], NO_RECORDS);
    expect(view.centered).toBe(true);
    expect(view.target).toBeNull();
    expect(view.path).toBe("/dashboard/intake/");
    expect(view.body).toMatch(/^Nothing here yet\./);
    expect(view.body).toMatch(/no leads to open yet/i);
  });

  it("says so differently when the read failed", () => {
    const view = stepView(lead.steps[0], { lead: null, matter: null, failed: true });
    expect(view.body).toMatch(/couldn't be loaded/);
    expect(view.body).not.toMatch(/^Nothing here yet/);
  });

  it("a matter step falls back to the matters list", () => {
    expect(stepView(byId("matters-page").steps[0], NO_RECORDS).path).toBe("/dashboard/matters/");
  });

  it("never lets a tampered id into a path", () => {
    const tampered = encodeRecords({ lead: "../../etc/passwd", matter: "ok_id-1", failed: false });
    const records = decodeRecords(tampered);
    expect(records.lead).toBeNull();
    expect(records.matter).toBe("ok_id-1");
    expect(stepView(lead.steps[0], records).path).not.toContain("..");
  });

  it.each([null, "", "nope", "[]", "42", '{"lead":5}'])("reads %j as no records", (raw) => {
    expect(decodeRecords(raw)).toEqual(expect.objectContaining({ lead: null, matter: null }));
  });

  it("converts a view to the engine's step shape", () => {
    const step = toTourStep(stepView(queue.steps[1], NO_RECORDS));
    expect(step).toMatchObject({ id: "queue", target: "queue-head" });
  });
});

describe("optimistic finish", () => {
  it("keeps local progress and no notice when the save fails", () => {
    const result = afterFinish(["intake-leads"], "matters-list", { ok: false });
    expect(result).toEqual({ done: ["intake-leads", "matters-list"], notice: null, saved: false });
  });

  it("does not repeat an id, and treats a thrown save (null) the same way", () => {
    expect(afterFinish(["a"], "a", null).done).toEqual(["a"]);
    expect(afterFinish([], "intake-leads", { ok: true })).toEqual({ done: ["intake-leads"], notice: null, saved: true });
  });

  it("round-trips local done through storage and survives bad values", () => {
    const store = memory();
    writeLocalDone(store, ["intake-leads"]);
    expect(readLocalDone(store)).toEqual(["intake-leads"]);
    store.setItem(HUB_LOCAL_DONE_KEY, "{not json");
    expect(readLocalDone(store)).toEqual([]);
    writeLocalDone(store, []);
    expect(store.getItem(HUB_LOCAL_DONE_KEY)).toBeNull();
  });

  it("storage that throws never throws out", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => storeStart(broken, lead, RECORDS)).not.toThrow();
    expect(() => clearFlow(broken)).not.toThrow();
    expect(readLocalDone(broken)).toEqual([]);
    expect(() => writeLocalDone(broken, ["x"])).not.toThrow();
  });
});
