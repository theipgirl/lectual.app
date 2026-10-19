import { describe, it, expect } from "vitest";
import type { Stage, Lead } from "@/lib/pipeline";
import {
  COLD_NO_TOUCH_DAYS,
  HOT_AFTER_EXCHANGE_DAYS,
  deriveTemperature,
  lastTouchAt,
} from "@/lib/intake";

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

// s1/s2 = ordinary open stages; s3 = a nurture stage. Stage aging thresholds no
// longer feed temperature (v2), so they are left at whatever the factory gives.
const STAGES: Stage[] = [
  stage({ id: "s1", order_index: 1, category: "open" }),
  stage({ id: "s2", order_index: 2, category: "open" }),
  stage({ id: "s3", order_index: 3, category: "nurture" }),
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

describe("deriveTemperature (v2)", () => {
  it("rule 0: a manual override always wins, even over a fresh reply", () => {
    const result = deriveTemperature(
      lead({ temperature: "cold", last_inbound_at: daysBefore(0) }),
      STAGES,
      NOW,
    );
    expect(result).toEqual({ level: "cold", reason: "Manually set", overridden: true });
  });

  it("rule 1: an unanswered client reply is hot, with the wait in the reason", () => {
    const result = deriveTemperature(lead({ last_inbound_at: daysBefore(2) }), STAGES, NOW);
    expect(result).toEqual({
      level: "hot",
      reason: "Replied 2 days ago — waiting on us",
      overridden: false,
    });
  });

  it("rule 1 has no time cap: a reply we never answered is still hot after 60 days", () => {
    const result = deriveTemperature(lead({ last_inbound_at: daysBefore(60) }), STAGES, NOW);
    expect(result.level).toBe("hot");
    expect(result.reason).toBe("Replied 60 days ago — waiting on us");
  });

  it("rule 1: an inbound newer than our last outbound is unanswered", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(1), last_outbound_at: daysBefore(5) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
    expect(result.reason).toMatch(/waiting on us/);
  });

  it("rule 1 beats a nurture stage (a reply in nurture is still waiting on us)", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "s3", last_inbound_at: daysBefore(20) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
  });

  it("rule 1 stops applying once we respond", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(20), last_outbound_at: daysBefore(15) }),
      STAGES,
      NOW,
    );
    // Answered, and the last touch (15d) is past the cold line.
    expect(result.level).toBe("cold");
  });

  it("rule 2: nurture-category stage is cold even when freshly touched", () => {
    const result = deriveTemperature(
      lead({
        current_stage_id: "s3",
        last_inbound_at: daysBefore(2),
        last_outbound_at: daysBefore(1),
      }),
      STAGES,
      NOW,
    );
    expect(result).toEqual({ level: "cold", reason: "Nurture stage", overridden: false });
  });

  it("rule 3: never touched is cold", () => {
    const result = deriveTemperature(lead({ current_stage_id: "s1" }), STAGES, NOW);
    expect(result).toEqual({ level: "cold", reason: "Never touched", overridden: false });
  });

  it("rule 4: we answered, and the exchange is within 3 days -> hot 'Active'", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
    expect(result.reason).toBe("Active — touched 1 day ago");
  });

  it("rule 4 boundary: exactly HOT_AFTER_EXCHANGE_DAYS still counts as hot", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(HOT_AFTER_EXCHANGE_DAYS + 2), last_outbound_at: daysBefore(HOT_AFTER_EXCHANGE_DAYS) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
  });

  it("rule 4 needs an inbound EVER: recent activity on a lead who never wrote is warm", () => {
    const result = deriveTemperature(
      lead({ last_activity_at: daysBefore(1), last_outbound_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("warm");
    expect(result.reason).toBe("Last touch 1 day ago");
  });

  it("rule 4 counts any touch (last_activity_at), not just email", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(8), last_outbound_at: daysBefore(7), last_activity_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("hot");
  });

  it("rule 5: no touch in COLD_NO_TOUCH_DAYS is cold, boundary inclusive", () => {
    const result = deriveTemperature(
      lead({ last_activity_at: daysBefore(COLD_NO_TOUCH_DAYS) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("cold");
    expect(result.reason).toBe("No touch in 10 days");
  });

  it("rule 6: between the hot and cold lines is warm", () => {
    const result = deriveTemperature(
      lead({ last_inbound_at: daysBefore(9), last_outbound_at: daysBefore(6) }),
      STAGES,
      NOW,
    );
    expect(result.level).toBe("warm");
    expect(result.reason).toBe("Last touch 6 days ago");
    expect(result.overridden).toBe(false);
  });

  it("rule 6 just under the cold line is still warm", () => {
    const result = deriveTemperature(lead({ last_activity_at: daysBefore(9) }), STAGES, NOW);
    expect(result.level).toBe("warm");
  });

  it("a stage missing from the list still resolves (no throw)", () => {
    const result = deriveTemperature(
      lead({ current_stage_id: "missing-stage", last_activity_at: daysBefore(1) }),
      STAGES,
      NOW,
    );
    expect(["hot", "warm", "cold"]).toContain(result.level);
  });

  it("is deterministic: same inputs, same answer", () => {
    const input = lead({ last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(1) });
    expect(deriveTemperature(input, STAGES, NOW)).toEqual(deriveTemperature(input, STAGES, NOW));
  });
});
