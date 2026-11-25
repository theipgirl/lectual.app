import { describe, expect, it } from "vitest";
import { chooseStartStage, defaultStartStageId, startStages } from "@/lib/review/add-lead-stage";

const st = (id: string, name: string, category: string, order_index: number | null) => ({ id, name, category, order_index });
const STAGES = [
  st("lost", "Not a fit", "lost", 9),
  st("consult", "Consult Scheduled", "open", 3),
  st("new", "Potential New Client", "open", 1),
  st("follow", "Follow-Up", "open", 2),
  st("won", "Signed LOE", "won", 5),
  st("nurture", "Long-Term Nurture", "nurture", 8),
];

describe("the Start in choices", () => {
  it("open stages only, in pipeline order; never won, lost or nurture", () => {
    expect(startStages(STAGES).map((s) => s.id)).toEqual(["new", "follow", "consult"]);
  });
  it("defaults to the new-enquiry stage", () => {
    expect(defaultStartStageId(STAGES)).toBe("new");
    expect(defaultStartStageId([st("a", "Intake call", "open", 2), st("b", "Other", "open", 1)])).toBe("b");
    expect(defaultStartStageId([st("w", "Won", "won", 1)])).toBeNull();
  });
});

describe("the server's check of the posted stage", () => {
  it("an open stage of the firm is used; past first contact joins the List", () => {
    expect(chooseStartStage(STAGES, "consult")).toEqual({ ok: true, stageId: "consult", joinsList: true });
    expect(chooseStartStage(STAGES, " new ")).toEqual({ ok: true, stageId: "new", joinsList: false });
    expect(chooseStartStage(STAGES, "follow")).toEqual({ ok: true, stageId: "follow", joinsList: false });
  });
  it("won, lost, nurture, a missing or foreign id, and anything that isn't a string are refused", () => {
    for (const bad of ["won", "lost", "nurture", "someone-elses-stage", "00000000-0000-4000-8000-000000000000", 5, {}, []]) expect(chooseStartStage(STAGES, bad), String(bad)).toEqual({ ok: false, reason: "not-open" });
  });
  it("no stage posted: createLead's own default (the new-enquiry stage)", () => {
    for (const none of [undefined, null, "", "   "]) expect(chooseStartStage(STAGES, none)).toEqual({ ok: true, stageId: null, joinsList: false });
  });
});
