import { describe, it, expect } from "vitest";
import {
  laneOf,
  laneReason,
  laneView,
  nextStepForLane,
  suggestionLine,
  NO_LANE_LINKS,
} from "@/lib/leads/lane";
import { matchesLane } from "@/lib/intake/rows";
import { triageLeadUpdate, type Triage } from "@/lib/agents/intake-triage";

describe("lane: a person's lane wins over the triage suggestion (SOP Stage 2)", () => {
  it("prefers the lane a person set over the agent's suggestion, and keeps both visible", () => {
    const view = laneView({ lane: "cold", lane_set_by: "user-1", lane_set_at: "2026-10-03T14:00:00Z", ai_summary: "HOT — ready now" });
    expect(view).toEqual({
      lane: "cold",
      setBy: "user-1",
      setAt: "2026-10-03T14:00:00Z",
      suggested: "hot",
      reason: "ready now",
      effective: "cold",
      source: "person",
    });
    expect(laneOf({ lane: "cold", ai_summary: "HOT — ready now" })).toBe("cold");
  });

  it("falls back to the triage suggestion, labelled as one, then to none", () => {
    const view = laneView({ lane: null, ai_summary: "WARM — comparing firms" });
    expect(view).toMatchObject({ lane: null, setBy: null, suggested: "warm", effective: "warm", source: "suggestion" });
    expect(suggestionLine(view)).toBe("Suggested: Warm — comparing firms");
    expect(laneOf({ lane: null, ai_summary: "Enriched from website" })).toBeNull();
    expect(laneOf({ lane: null, ai_summary: null })).toBeNull();
  });

  it("never reads the board's temperature as a lane", () => {
    // temperature is the activity-derived heat (and was written by triage's old
    // act mode with no person behind it) — it is not routing.
    const lead = { lane: null, ai_summary: null, temperature: "hot" } as Parameters<typeof laneView>[0];
    expect(laneView(lead).effective).toBeNull();
  });

  it("strips the lane prefix from the reason, and only from a real suggestion", () => {
    expect(laneReason("HOT — Ready to file this month.")).toBe("Ready to file this month.");
    expect(laneReason("Enriched from website")).toBeNull();
    expect(laneReason(null)).toBeNull();
  });

  it("triage never writes the lane or the temperature, at any autonomy", () => {
    const hot: Triage = { lane: "hot", readiness: 5, value: "HIGH", urgency: "2d", practice_fit: "strong", reason: "Ready.", red_flags: [] };
    for (const autonomy of ["suggest", "draft", "act"] as const) {
      const update = triageLeadUpdate(hot, autonomy, "2026-10-09T00:00:00Z");
      for (const key of ["lane", "lane_set_by", "lane_set_at", "temperature", "temperature_set_by", "temperature_set_at"]) {
        expect(update, `${autonomy}:${key}`).not.toHaveProperty(key);
      }
    }
    expect(triageLeadUpdate(hot, "act", "2026-10-09T00:00:00Z")).toEqual({
      ai_enriched_at: "2026-10-09T00:00:00Z",
      ai_summary: "HOT — Ready.",
      ai_red_flags: [],
    });
  });
});

describe("lane filter on Intake", () => {
  const person = laneView({ lane: "hot", lane_set_by: "u", ai_summary: "COLD — exploring" });
  const suggested = laneView({ lane: null, ai_summary: "HOT — urgent" });
  const none = laneView({ lane: null, ai_summary: null });
  it("hot / warm / cold match the lane routing goes by", () => {
    expect(matchesLane(person, "hot")).toBe(true);
    expect(matchesLane(person, "cold")).toBe(false);
    expect(matchesLane(suggested, "hot")).toBe(true);
  });
  it("'suggested' is the unreviewed triage sample; 'none' is no lane and no suggestion", () => {
    expect(matchesLane(suggested, "suggested")).toBe(true);
    expect(matchesLane(person, "suggested")).toBe(false);
    expect(matchesLane(none, "none")).toBe(true);
    expect(matchesLane(suggested, "none")).toBe(false);
  });
});

describe("next step by lane", () => {
  const links = {
    strategySessionUrl: "https://book.example.com/strategy",
    discoveryCallUrl: "https://book.example.com/discovery",
    nurtureSequenceId: "seq-1",
  };
  it("Hot → book a strategy session, Warm → discovery call, Cold → add to nurture", () => {
    expect(nextStepForLane("hot", links)).toEqual({
      kind: "strategy_session",
      label: "Book a strategy session",
      url: "https://book.example.com/strategy",
      missing: null,
    });
    expect(nextStepForLane("warm", links)).toMatchObject({ kind: "discovery_call", label: "Discovery call", url: "https://book.example.com/discovery" });
    expect(nextStepForLane("cold", links)).toMatchObject({ kind: "nurture", label: "Add to nurture", sequenceId: "seq-1", missing: null });
  });
  it("names the missing firm setting instead of inventing a link", () => {
    expect(nextStepForLane("hot", NO_LANE_LINKS)).toMatchObject({ url: null, missing: expect.stringContaining("Firm profile") });
    expect(nextStepForLane("cold", NO_LANE_LINKS)).toMatchObject({ sequenceId: null, missing: expect.stringContaining("nurture campaign") });
  });
  it("no lane, no next step", () => {
    expect(nextStepForLane(null, links)).toBeNull();
  });
});
