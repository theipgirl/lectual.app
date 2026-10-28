import { describe, it, expect } from "vitest";
import { NEW_ENQUIRY_STAGE_NAMES, newEnquiryStage } from "@/lib/pipeline/new-enquiry";
import { compareStageOrder, inPipelineOrder } from "@/lib/pipeline/stage-order";
import { firstOpenIntakeStageId } from "@/lib/intake-forms/public-submit";
import type { Stage } from "@/lib/pipeline/stages";

/** Sprint 29 F: where a lead with no stage evidence goes, and one stage order everywhere. */

const st = (id: string, name: string, order_index: number | null, category = "open") => ({ id, name, order_index, category });

/** RPB: "Follow-Up" is stage 1, the new-enquiry stage is "Potential New Client". */
const RPB = [
  st("follow", "Follow-Up", 1),
  st("pnc", "Potential New Client", 2),
  st("prelim", "Preliminary Search", 3),
  st("consult", "Consultation Scheduled", 4),
  st("won", "Signed LOE / Deposit Received", 8, "won"),
  st("nurture", "Nurture", 9, "nurture"),
  st("lost", "Lost", 10, "lost"),
];

describe("the new-enquiry stage", () => {
  it("is the open stage named like Potential New Client, never Follow-Up just because it sorts first", () => {
    expect(newEnquiryStage(RPB)?.id).toBe("pnc");
  });

  it("the alias list is one list, tried in order, spelling and punctuation ignored", () => {
    expect(NEW_ENQUIRY_STAGE_NAMES).toEqual(["Potential New Client", "New Lead", "New Inquiry", "New Enquiry"]);
    expect(newEnquiryStage([st("a", "Follow-Up", 1), st("b", "NEW INQUIRY", 5), st("c", "new-lead", 6)])?.id).toBe("c");
    expect(newEnquiryStage([st("a", "Follow-Up", 1), st("b", "New Enquiry", 5)])?.id).toBe("b");
    expect(newEnquiryStage([st("a", "3. Potential New Client", 3)])?.id).toBe("a");
  });

  it("falls back to the first OPEN stage in the firm's order when none is named like one", () => {
    expect(newEnquiryStage([st("w", "Hired", 0, "won"), st("b", "Second", 2), st("a", "First", 1), st("n", "Nurture", 0, "nurture")])?.id).toBe("a");
  });

  it("never a won, lost or nurture stage, even when it is named like one and is the only candidate", () => {
    expect(newEnquiryStage([st("p", "Potential New Client", 1, "won"), st("n", "New Lead", 2, "nurture"), st("l", "New Inquiry", 3, "lost")])).toBeNull();
    expect(newEnquiryStage([])).toBeNull();
  });

  it("a duplicate order_index is broken the same way every time (name, then id), whatever order the rows arrive in", () => {
    const a = [st("2", "Beta", 1), st("1", "Alpha", 1)];
    expect(newEnquiryStage(a)?.id).toBe("1");
    expect(newEnquiryStage([...a].reverse())?.id).toBe("1");
  });

  it("the public intake form uses the same rule", () => {
    const stages = RPB.map((s) => ({ ...s, aging_threshold_days: null, org_id: "o", created_at: "" })) as unknown as Stage[];
    expect(firstOpenIntakeStageId(stages)).toBe("pnc");
  });
});

describe("one stage order", () => {
  it("sorts by order_index, then name, then id; a missing number sorts last", () => {
    const sorted = inPipelineOrder([
      st("z", "Zed", 2),
      st("n", "None", null),
      st("b", "Same", 1),
      st("a", "Same", 1),
      st("m", "Mid", 1),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["m", "a", "b", "z", "n"]);
    expect(compareStageOrder(st("x", "A", 1), st("x", "A", 1))).toBe(0);
  });

  it("does not mutate its input", () => {
    const input = [st("b", "B", 2), st("a", "A", 1)];
    inPipelineOrder(input);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
