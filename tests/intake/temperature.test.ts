import { describe, it, expect } from "vitest";
import type { Stage, Lead } from "@/lib/pipeline";
import { deriveTemperature, lastTouchAt } from "@/lib/intake";

const NOW = new Date("2026-09-14T12:00:00.000Z");

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

function lead(overrides: Partial<Lead>): Pick<
  Lead,
  "temperature" | "current_stage_id" | "last_activity_at" | "last_outbound_at" | "last_inbound_at"
> {
  return {
    temperature: null,
    current_stage_id: "s2",
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    ...overrides,
  };
}

function daysBefore(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

// s1 = first intake stage (order 1); s2 = a later intake stage with a 7-day
// aging threshold; s3 = a nurture stage; s4 = a stage with NO aging threshold
// set (falls back to the default 7).
const STAGES: Stage[] = [
  stage({ id: "s1", order_index: 1, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s2", order_index: 2, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s3", order_index: 3, category: "nurture", aging_threshold_days: 30 }),
  stage({ id: "s4", order_index: 4, category: "open", aging_threshold_days: null }),
];

describe("lastTouchAt", () => {
  it("returns the greatest of the three timestamps", () => {
    expect(
      lastTouchAt({
        last_activity_at: daysBefore(10),
        last_outbound_at: daysBefore(2),
        last_inbound_at: daysBefore(5),
      }),
    ).toBe(daysBefore(2));
  });

  it("returns null when never touched", () => {
    expect(lastTouchAt({ last_activity_at: null, last_outbound_at: null, last_inbound_at: null })).toBeNull();
  });
});

describe("deriveTemperature", () => {
  it("rule 0: a manual override always wins, even over a fresh reply", () => {
    const result = deriveTemperature(
      lead({ temperature: "cold", last_inbound_at: daysBefore(0) }),
      STAGES,
      NOW,
    );
    expect(result).toEqual({ level: "cold", reason: "Manually set", overridden: true });
  });

  it("rule 1: inbound reply within 7 days is hot, regardless of stage", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s3", last_inbound_at: daysBefore(2) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
    expect(result.overridden).toBe(false);
    expect(result.reason).toMatch(/Replied/);
  });

  it("rule 1 boundary: exactly 7 days ago still counts as hot", () => {
    const result = deriveTemperature(lead({ last_inbound_at: daysBefore(7) }), STAGES, NOW);
    expect(result.level).toBe("hot");
  });

  it("rule 2: not the first intake stage, touched within the stage's aging threshold -> hot", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s2", last_activity_at: daysBefore(3) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
    expect(result.overridden).toBe(false);
  });

  it("rule 2 does not apply to the first intake stage even if freshly touched", () => {
    // s1 is the first intake stage; recent touch there should NOT trigger rule 2's
    // "hot" — it falls through to rule 4 (warm) since it's not nurture/stale/never-touched.
    const result = deriveTemperature(
      lead({ current_stage_id: "s1", last_activity_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("warm");
  });

  it("rule 2 uses the default aging threshold (7) when the stage has none set", () => {
    const withinDefault = deriveTemperature(
      lead({ current_stage_id: "s4", last_activity_at: daysBefore(6) }),
      STAGES,
      NOW,
    );
    expect(withinDefault.level).toBe("hot");

    const pastDefault = deriveTemperature(
      lead({ current_stage_id: "s4", last_activity_at: daysBefore(29) }),
      STAGES,
      NOW,
    );
    // 29 days: past the default-7 aging window (so rule 2 doesn't fire) but
    // under the 30-day cold threshold (so rule 3 doesn't fire either) -> warm.
    expect(pastDefault.level).toBe("warm");
  });

  it("rule 2 can still make a nurture stage hot when touched within ITS aging threshold (first match wins)", () => {
    // s3 is nurture with a 30-day threshold and isn't the first intake stage,
    // so a touch inside that window satisfies rule 2 before rule 3 is ever
    // reached — "first match wins" is literal, rule order beats rule content.
    const result = deriveTemperature(
      lead({ current_stage_id: "s3", last_activity_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
  });

  it("rule 3: nurture-category stage past its own aging threshold is cold", () => {
    // Touch is outside s3's 30-day aging window, so rule 2 does not fire and
    // rule 3's nurture-category check does.
    const result = deriveTemperature(
      lead({ current_stage_id: "s3", last_activity_at: daysBefore(31) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("cold");
    // Both the nurture-category clause and the 30+-day clause of rule 3 match
    // here; the nurture reason is the more informative one to surface.
    expect(["Nurture stage", "No touch in 31 days"]).toContain(result.reason);
  });

  it("rule 3: never touched is cold", () => {
    const result = deriveTemperature(lead({ current_stage_id: "s1" }), STAGES, NOW);
    expect(result.level).toBe("cold");
    expect(result.reason).toBe("Never touched");
  });

  it("rule 3: no touch in 30+ days is cold", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s1", last_activity_at: daysBefore(31) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("cold");
    expect(result.reason).toMatch(/No touch in 31 days/);
  });

  it("rule 3 boundary: exactly 30 days is cold", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s1", last_activity_at: daysBefore(30) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("cold");
  });

  it("rule 4: otherwise warm", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s1", last_activity_at: daysBefore(15) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("warm");
    expect(result.overridden).toBe(false);
  });

  it("a tenant whose current stage isn't found in the stage list still resolves (no throw)", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "missing-stage", last_activity_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(["hot", "warm", "cold"]).toContain(result.level);
  });
});
