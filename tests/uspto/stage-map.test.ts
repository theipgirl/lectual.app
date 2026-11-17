import { describe, expect, it } from "vitest";
import { STAGE_MAP, suggestStage } from "@/lib/uspto/stage-map";

describe("stage map", () => {
  it.each([
    [602, null, "abandoned", ["Abandoned"], null, "code"],
    [700, null, "registered", ["Registered"], "section_8_declaration", "code"],
    [680, null, "published", ["Publication for Opposition"], "opposition_window", "code"],
    [641, null, "office_action", ["OA Issued"], "office_action_response", "code"],
    [630, null, "new_application", ["Application Filed"], null, "code"],
    [1, "Abandoned - No statement of use filed", "abandoned", ["Abandoned"], null, "text"],
    [1, "Registered. The registration date is used to determine when post-registration maintenance documents are due.", "registered", ["Registered"], "section_8_declaration", "text"],
    [1, "Response after non-final action - entered", "response_filed", ["Awaiting Trademark Registration"], null, "text"],
    [1, "Notice of allowance - issued", "notice_of_allowance", ["Awaiting Trademark Registration"], "statement_of_use", "text"],
    [1, "Published for opposition", "published", ["Publication for Opposition"], "opposition_window", "text"],
    [1, "Final refusal - mailed", "office_action", ["OA Issued"], "office_action_response", "text"],
    [1, "New application - record initialized", "new_application", ["Application Filed"], null, "text"],
    [1, "Assigned to examiner", "pending_examination", ["Awaiting Trademark Registration"], null, "text"],
  ])("code %s / %j -> %s", (statusCode, statusText, key, names, deadline, by) => {
    expect(suggestStage({ statusCode, statusText })).toEqual({ key, stageNames: names, deadlineKind: deadline, matchedBy: by });
  });
  it("every table row is exercised above by key", () => {
    expect(STAGE_MAP.map((r) => r.key).sort()).toEqual(
      ["abandoned", "registered", "response_filed", "notice_of_allowance", "published", "office_action", "new_application", "pending_examination"].sort(),
    );
  });
  it("a code beats contradicting text", () => {
    expect(suggestStage({ statusCode: 700, statusText: "Abandoned" }).key).toBe("registered");
  });
  it("cancelled / expired registrations are unknown, not Registered", () => {
    expect(suggestStage({ statusCode: 1, statusText: "Cancelled - Section 8" }).key).toBe("unknown");
    expect(suggestStage({ statusCode: 1, statusText: "Expired" }).key).toBe("unknown");
  });
  it("unknown status maps to unknown with nothing suggested", () => {
    expect(suggestStage({ statusCode: 999, statusText: "Something new" })).toEqual({ key: "unknown", stageNames: [], deadlineKind: null, matchedBy: "none" });
    expect(suggestStage({ statusCode: 999, statusText: null }).key).toBe("unknown");
  });
});
