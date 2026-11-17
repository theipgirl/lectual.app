import { describe, expect, it } from "vitest";
import { STAGE_MAP, suggestStage, suggestStageWith, type Row } from "@/lib/uspto/stage-map";

const AWAIT = ["Awaiting Trademark Registration"];

describe("stage map (text rules)", () => {
  it.each([
    ["Abandoned - No statement of use filed", "abandoned", ["Abandoned"], null],
    ["Abandoned - failure to respond or late response", "abandoned", ["Abandoned"], null],
    ["Registered. The registration date is used to determine when post-registration maintenance documents are due.", "registered", ["Registered"], "section_8_declaration"],
    ["Registered and renewed", "registered_maintained", ["Registered"], null],
    ["Registered - Sec. 8 (6-year) accepted & Sec. 15 acknowledged", "registered_maintained", ["Registered"], null],
    ["Response after non-final action - entered", "response_filed", AWAIT, null],
    ["Request for reconsideration after final refusal - received", "response_filed", AWAIT, null],
    ["Petition to Director - granted", "response_filed", AWAIT, null],
    ["Notice of allowance - issued", "notice_of_allowance", AWAIT, "statement_of_use"],
    ["Approved for publication", "approved_for_publication", AWAIT, null],
    ["Published for opposition", "published", ["Publication for Opposition"], "opposition_window"],
    ["Notice of publication", "published", ["Publication for Opposition"], "opposition_window"],
    ["Final refusal - mailed", "office_action", ["OA Issued"], "office_action_response"],
    ["Non-final action - mailed", "office_action", ["OA Issued"], "office_action_response"],
    ["New application - record initialized", "new_application", ["Application Filed"], null],
    ["Assigned to examiner", "pending_examination", AWAIT, null],
  ])("%s -> %s", (statusText, key, names, deadline) => {
    expect(suggestStage({ statusCode: 1, statusText })).toEqual({ key, stageNames: names, deadlineKind: deadline, matchedBy: "text" });
  });

  it.each([
    "Petition to revive abandoned application - granted",
    "Abandonment reinstated",
    "Withdrawn from publication",
    "Notice of publication cancelled",
    "Cancelled - Section 8",
    "Expired",
    "Something new the USPTO invented",
  ])("unknown: %s", (statusText) => {
    expect(suggestStage({ statusCode: 1, statusText })).toEqual({ key: "unknown", stageNames: [], deadlineKind: null, matchedBy: "none" });
  });

  it("no text is unknown", () => {
    expect(suggestStage({ statusCode: 999, statusText: null }).key).toBe("unknown");
  });

  it("every non-exclusion row is exercised above, and the codes table is empty until a real response confirms it", () => {
    expect(STAGE_MAP.filter((r) => r.stageNames.length > 0).map((r) => r.key).sort()).toEqual(
      ["abandoned", "registered", "registered_maintained", "response_filed", "notice_of_allowance", "approved_for_publication", "published", "office_action", "new_application", "pending_examination"].sort(),
    );
    expect(STAGE_MAP.flatMap((r) => r.codes)).toEqual([]);
  });
});

describe("code mechanism (injected table)", () => {
  const table: Row[] = [
    { key: "reg", codes: [700], text: [/^registered/i], stageNames: ["Registered"], deadlineKind: null },
    { key: "abn", codes: [602], text: [/abandon/i], stageNames: ["Abandoned"], deadlineKind: null },
  ];
  it("a code alone, text alone, or both agreeing map", () => {
    expect(suggestStageWith(table, { statusCode: 700, statusText: null }).matchedBy).toBe("code");
    expect(suggestStageWith(table, { statusCode: 700, statusText: "Registered" }).key).toBe("reg");
    expect(suggestStageWith(table, { statusCode: 1, statusText: "Abandoned" }).matchedBy).toBe("text");
  });
  it("a conflict is unknown", () => {
    expect(suggestStageWith(table, { statusCode: 700, statusText: "Abandoned" })).toEqual({
      key: "unknown", stageNames: [], deadlineKind: null, matchedBy: "code+text-conflict",
    });
  });
});
