import { describe, it, expect } from "vitest";
import type { Stage } from "@/lib/pipeline";
import { deriveTemperature } from "@/lib/intake";
import {
  effectiveTemperature,
  temperatureLabel,
  temperatureTitle,
  type EffectiveTemperatureLead,
} from "@/lib/intake/effective-temperature";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function daysBefore(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function stage(overrides: Partial<Stage>): Stage {
  return {
    id: "stage-1",
    org_id: "org-1",
    name: "Stage",
    order_index: 1,
    category: "open",
    aging_threshold_days: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Stage;
}

// Same shape as tests/intake/temperature.test.ts: s1/s2 ordinary open stages, s3 a nurture stage.
const STAGES: Stage[] = [
  stage({ id: "s1", order_index: 1, category: "open" }),
  stage({ id: "s2", order_index: 2, category: "open" }),
  stage({ id: "s3", order_index: 3, category: "nurture" }),
];

function lead(overrides: Partial<EffectiveTemperatureLead>): EffectiveTemperatureLead {
  return {
    temperature: null,
    lane: null,
    lane_set_at: null,
    ai_summary: null,
    current_stage_id: "s2",
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    ...overrides,
  };
}

describe("a person's lane wins", () => {
  it("returns the lane with source 'person' and a reason that begins 'Set by'", () => {
    const result = effectiveTemperature(lead({ lane: "cold", lane_set_at: daysBefore(1) }), STAGES, NOW);
    expect(result.value).toBe("cold");
    expect(result.source).toBe("person");
    expect(result.reason.startsWith("Set by")).toBe(true);
  });

  it("wins even when the derivation disagrees", () => {
    const l = lead({ lane: "cold", lane_set_at: daysBefore(0), last_inbound_at: daysBefore(1) });
    expect(deriveTemperature({ ...l, temperature: null }, STAGES, NOW).level).toBe("hot");
    expect(effectiveTemperature(l, STAGES, NOW)).toMatchObject({ value: "cold", source: "person" });
  });

  it("ignores an unrecognised lane value", () => {
    const l = lead({ lane: "lukewarm" as never, last_inbound_at: daysBefore(1) });
    expect(effectiveTemperature(l, STAGES, NOW)).toMatchObject({ value: "hot", source: "suggested" });
  });
});

describe("no lane: the derivation decides", () => {
  it("returns the derived level, source 'suggested' and the derivation's reason", () => {
    const l = lead({ last_outbound_at: daysBefore(2), last_inbound_at: daysBefore(3) });
    const derived = deriveTemperature({ ...l, temperature: null }, STAGES, NOW);
    expect(effectiveTemperature(l, STAGES, NOW)).toEqual({
      value: derived.level,
      source: "suggested",
      reason: derived.reason,
    });
  });

  it("appends the triage agent's reason from ai_summary when it left one", () => {
    const l = lead({ last_activity_at: daysBefore(6), ai_summary: "HOT — filing this month" });
    const result = effectiveTemperature(l, STAGES, NOW);
    expect(result.value).toBe("warm");
    expect(result.reason).toBe("Last touch 6 days ago · Triage: filing this month");
  });

  it("does not append anything for an ai_summary that carries no lane", () => {
    const l = lead({ last_activity_at: daysBefore(6), ai_summary: "Enriched from website" });
    expect(effectiveTemperature(l, STAGES, NOW).reason).toBe("Last touch 6 days ago");
  });

  it("does not take its value from the triage suggestion", () => {
    const l = lead({ last_activity_at: daysBefore(6), ai_summary: "HOT — filing this month" });
    expect(effectiveTemperature(l, STAGES, NOW).value).toBe("warm");
  });
});

describe("a leftover crm_lead.temperature value is ignored", () => {
  it("does not pin a lead hot", () => {
    const l = lead({ temperature: "hot", last_activity_at: daysBefore(20) });
    expect(effectiveTemperature(l, STAGES, NOW)).toMatchObject({ value: "cold", source: "suggested" });
    expect(effectiveTemperature(l, STAGES, NOW).reason).not.toContain("Manually set");
  });

  it("does not turn a never-touched lead into a hot one", () => {
    expect(effectiveTemperature(lead({ temperature: "hot" }), STAGES, NOW).value).toBeNull();
  });
});

describe("activityHint", () => {
  it("reads 'Activity: hot · …' when an unanswered reply is newer than a lane set to cold", () => {
    const l = lead({ lane: "cold", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    const result = effectiveTemperature(l, STAGES, NOW);
    expect(result.value).toBe("cold");
    expect(result.activityHint).toBe("Activity: hot · Replied 2 days ago — waiting on us");
  });

  it("is given when the lane has no set time at all", () => {
    const l = lead({ lane: "cold", lane_set_at: null, last_inbound_at: daysBefore(2) });
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toMatch(/^Activity: hot · /);
  });

  it("is absent when the lane and the derivation agree", () => {
    const l = lead({ lane: "hot", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toBeUndefined();
  });

  it("is absent when there is no lane", () => {
    const l = lead({ last_inbound_at: daysBefore(2) });
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toBeUndefined();
  });

  it("is absent when the lane was set after the last touch", () => {
    const l = lead({ lane: "cold", lane_set_at: daysBefore(1), last_inbound_at: daysBefore(2) });
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toBeUndefined();
  });

  it("is absent for the touch the lane change itself leaves a moment later", () => {
    const setAt = daysBefore(1);
    const ownTouch = new Date(Date.parse(setAt) + 2_000).toISOString();
    const l = lead({ lane: "cold", lane_set_at: setAt, last_activity_at: ownTouch });
    expect(deriveTemperature({ ...l, temperature: null }, STAGES, NOW).level).toBe("warm");
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toBeUndefined();
  });

  it("is absent when the only newer thing is the 'Never touched' fallback", () => {
    const l = lead({ lane: "hot", lane_set_at: daysBefore(5) });
    expect(deriveTemperature({ ...l, temperature: null }, STAGES, NOW).reason).toBe("Never touched");
    expect(effectiveTemperature(l, STAGES, NOW).activityHint).toBeUndefined();
  });
});

describe("no lane and no data is null (Not routed)", () => {
  it("is null for a never-touched lead with no facts and a non-nurture stage", () => {
    const result = effectiveTemperature(lead({}), STAGES, NOW);
    expect(result.value).toBeNull();
    expect(result.source).toBe("suggested");
    expect(result.reason).toBe("Never touched");
  });

  it("is never null for a lead with any touch", () => {
    for (const stamp of ["last_activity_at", "last_outbound_at", "last_inbound_at"] as const) {
      expect(effectiveTemperature(lead({ [stamp]: daysBefore(30) }), STAGES, NOW).value).not.toBeNull();
    }
  });

  it("is never null for a nurture-stage lead", () => {
    expect(effectiveTemperature(lead({ current_stage_id: "s3" }), STAGES, NOW)).toMatchObject({ value: "cold", reason: "Nurture stage" });
  });

  it("is never null for a fact-driven lead", () => {
    expect(effectiveTemperature(lead({}), STAGES, NOW, { sequenceEndedNoReplyAt: daysBefore(1) }).value).toBe("cold");
    expect(effectiveTemperature(lead({}), STAGES, NOW, { firstTouchAt: daysBefore(11) }).value).toBe("cold");
  });
});

describe("the Long-Term Nurture suggestion is passed through", () => {
  const facts = { firstTouchAt: daysBefore(11) };

  it("without a lane", () => {
    const result = effectiveTemperature(lead({ last_outbound_at: daysBefore(2) }), STAGES, NOW, facts);
    expect(result.suggestion).toBe("long_term_nurture");
  });

  it("with a lane", () => {
    const l = lead({ lane: "hot", lane_set_at: daysBefore(0), last_outbound_at: daysBefore(2) });
    const result = effectiveTemperature(l, STAGES, NOW, facts);
    expect(result).toMatchObject({ value: "hot", source: "person", suggestion: "long_term_nurture" });
  });

  it("is absent when the derivation makes none", () => {
    expect("suggestion" in effectiveTemperature(lead({ last_outbound_at: daysBefore(2) }), STAGES, NOW)).toBe(false);
  });
});

describe("the words on the chip", () => {
  it("says the level for a person's, 'Suggested: <level>' for a derived one and 'Not routed' for neither", () => {
    expect(temperatureLabel({ value: "hot", source: "person" })).toBe("Hot");
    expect(temperatureLabel({ value: "warm", source: "suggested" })).toBe("Suggested: Warm");
    expect(temperatureLabel({ value: null, source: "suggested" })).toBe("Not routed");
  });

  it("puts the activity hint under the reason in the tooltip", () => {
    expect(temperatureTitle({ reason: "Set by a person" })).toBe("Set by a person");
    expect(temperatureTitle({ reason: "Set by a person", activityHint: "Activity: hot · Replied today — waiting on us" })).toBe(
      "Set by a person\nActivity: hot · Replied today — waiting on us",
    );
  });
});
