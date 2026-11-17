import { describe, expect, it } from "vitest";
import { matchRecord } from "@/lib/meeting-assistant";
import { input } from "./fixtures";

describe("matchRecord", () => {
  it("matches an exact unique client or mark, case-insensitively", () => {
    expect(matchRecord("  MAYA   chen ", input.rows)).toEqual({ kind: "matter", id: "r1" });
    expect(matchRecord("the pleat", input.rows)).toEqual({ kind: "matter", id: "r1" });
  });
  it("never guesses", () => {
    expect(matchRecord("Maya", input.rows)).toBe("unmatched");
    expect(matchRecord("", input.rows)).toBe("unmatched");
    expect(matchRecord(null, input.rows)).toBe("unmatched");
    expect(matchRecord("Maya Chen", [input.rows[0], { ...input.rows[1], client: "Maya Chen" }])).toBe("unmatched");
  });
});
