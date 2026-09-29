import { describe, it, expect } from "vitest";
import { laneOf, laneReason } from "@/lib/leads/lane";

describe("laneOf", () => {
  it("prefers a person's call over the agent's", () => {
    expect(laneOf({ temperature: "cold", ai_summary: "HOT — ready now" })).toBe("cold");
  });
  it("falls back to the triage agent's lane, then to none", () => {
    expect(laneOf({ temperature: null, ai_summary: "WARM — comparing firms" })).toBe("warm");
    expect(laneOf({ temperature: null, ai_summary: "Enriched from website" })).toBeNull();
    expect(laneOf({ temperature: null, ai_summary: null })).toBeNull();
  });
  it("strips the lane prefix from the reason", () => {
    expect(laneReason("HOT — Ready to file this month.")).toBe("Ready to file this month.");
    expect(laneReason(null)).toBeNull();
  });
});
