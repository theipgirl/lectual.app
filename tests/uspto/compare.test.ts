import { describe, expect, it } from "vitest";
import { compareStatusToStage } from "@/lib/uspto/compare";
import { parseTsdrStatus } from "@/lib/uspto/parse";
import type { FetchStatusResult } from "@/lib/uspto/fetch-status";
import { officeAction, registered, unknownStatus } from "./fixtures";

function okRead(body: unknown): FetchStatusResult {
  const p = parseTsdrStatus(body);
  if (!p.ok) throw new Error("bad fixture");
  return { status: "ok", result: p.value };
}

describe("compareStatusToStage", () => {
  it("agrees, ignoring the numeric code and case", () => {
    expect(compareStatusToStage(okRead(officeAction), "19A. OA Issued")).toEqual({
      verdict: "agree", usptoStageNames: ["OA Issued"], lectualStage: "19A. OA Issued",
    });
    expect(compareStatusToStage(okRead(registered), "registered").verdict).toBe("agree");
  });
  it("differs, with both names", () => {
    expect(compareStatusToStage(okRead(registered), "18. Awaiting Trademark Registration")).toEqual({
      verdict: "differs", usptoStageNames: ["Registered"], lectualStage: "18. Awaiting Trademark Registration",
    });
  });
  it("an unavailable read is never agreement", () => {
    for (const reason of ["timeout", "http_500", "not_found", "rate_limited", "shape"] as const) {
      const r = compareStatusToStage({ status: "unavailable", reason }, "Registered");
      expect(r.verdict).toBe("unknown");
      expect(r.unknownBecause).toBe("unavailable");
    }
    expect(compareStatusToStage({ status: "not-set-up" }, "Registered")).toMatchObject({ verdict: "unknown", unknownBecause: "not-set-up" });
  });
  it("unmapped USPTO status and missing Lectual stage are unknown", () => {
    expect(compareStatusToStage(okRead(unknownStatus), "Registered")).toMatchObject({ verdict: "unknown", unknownBecause: "unmapped" });
    expect(compareStatusToStage(okRead(registered), null)).toMatchObject({ verdict: "unknown", unknownBecause: "no-lectual-stage", usptoStageNames: ["Registered"] });
    expect(compareStatusToStage(okRead(registered), "  ").verdict).toBe("unknown");
  });
});
