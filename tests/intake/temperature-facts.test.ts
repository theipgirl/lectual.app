import { describe, it, expect } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import { COLD_NO_TOUCH_DAYS, deriveTemperature, type TemperatureFacts } from "@/lib/intake/temperature";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function stage(overrides: Partial<Stage>): Stage {
  return {
    id: "s1",
    org_id: "org-1",
    name: "Follow-Up",
    order_index: 1,
    category: "open",
    aging_threshold_days: null,
    created_at: NOW.toISOString(),
    ...overrides,
  } as Stage;
}
const STAGES = [stage({ id: "s1" }), stage({ id: "s-nurture", category: "nurture", name: "Nurture" })];

function lead(overrides: Partial<Lead> = {}) {
  return {
    temperature: null,
    current_stage_id: "s1",
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    ...overrides,
  } as Pick<Lead, "temperature" | "current_stage_id" | "last_activity_at" | "last_outbound_at" | "last_inbound_at">;
}

describe("deriveTemperature without facts (backward compatibility)", () => {
  it("returns no suggestion key and the same answer with facts omitted, empty or all-null", () => {
    const l = lead({ last_outbound_at: daysBefore(12) });
    const plain = deriveTemperature(l, STAGES, NOW);
    expect(plain).toEqual({ level: "cold", reason: "No touch in 12 days", overridden: false });
    expect("suggestion" in plain).toBe(false);
    expect(deriveTemperature(l, STAGES, NOW, {})).toEqual(plain);
    expect(deriveTemperature(l, STAGES, NOW, { sequenceEndedNoReplyAt: null, bookedAt: null, firstTouchAt: null })).toEqual(plain);
  });
});

describe("rule: the standard sequence ended with no reply", () => {
  const facts: TemperatureFacts = { sequenceEndedNoReplyAt: daysBefore(2) };

  it("reads cold with a reason that names the sequence", () => {
    const t = deriveTemperature(lead({ last_outbound_at: daysBefore(2) }), STAGES, NOW, facts);
    expect(t.level).toBe("cold");
    expect(t.reason).toBe("3-email sequence ended, no reply");
    expect(t.reason).toContain("sequence");
    expect(t.overridden).toBe(false);
  });

  it("rule 1 wins: an unanswered reply after enrolment is hot", () => {
    const t = deriveTemperature(
      lead({ last_inbound_at: daysBefore(1), last_outbound_at: daysBefore(5) }),
      STAGES,
      NOW,
      facts,
    );
    expect(t.level).toBe("hot");
    expect(t.reason).toContain("waiting on us");
  });

  it("ignores a stale fact when the lead has written since, even if we answered", () => {
    const t = deriveTemperature(
      lead({ last_inbound_at: daysBefore(1), last_outbound_at: daysBefore(0.5), last_activity_at: daysBefore(0.5) }),
      STAGES,
      NOW,
      facts,
    );
    expect(t.reason).not.toContain("sequence");
    expect(t.level).toBe("hot"); // rule 4: a live exchange
  });

  it("a manual temperature still wins, with no suggestion", () => {
    const t = deriveTemperature(lead({ temperature: "warm" }), STAGES, NOW, { ...facts, firstTouchAt: daysBefore(30) });
    expect(t).toEqual({ level: "warm", reason: "Manually set", overridden: true });
  });
});

describe("rule: unbooked by day 10 suggests Long-Term Nurture", () => {
  it("uses COLD_NO_TOUCH_DAYS for its boundary", () => {
    const at = (days: number) =>
      deriveTemperature(lead({ last_outbound_at: daysBefore(1) }), STAGES, NOW, { firstTouchAt: daysBefore(days) });
    expect(at(COLD_NO_TOUCH_DAYS).suggestion).toBe("long_term_nurture");
    expect(at(COLD_NO_TOUCH_DAYS - 0.5).suggestion).toBeUndefined();
  });

  it("first touch 11 days ago, not booked: cold, the reason and the suggestion", () => {
    const t = deriveTemperature(lead({ last_outbound_at: daysBefore(2) }), STAGES, NOW, {
      firstTouchAt: daysBefore(11),
      bookedAt: null,
    });
    expect(t.level).toBe("cold");
    expect(t.reason).toContain("Unbooked by day 10");
    expect(t.reason).toContain("Long-Term Nurture suggested");
    expect(t.suggestion).toBe("long_term_nurture");
    expect(t.overridden).toBe(false);
  });

  it("first touch 9 days ago: no suggestion, falls through to the existing rules", () => {
    const l = lead({ last_outbound_at: daysBefore(4) });
    const t = deriveTemperature(l, STAGES, NOW, { firstTouchAt: daysBefore(9) });
    expect(t.suggestion).toBeUndefined();
    expect(t).toEqual(deriveTemperature(l, STAGES, NOW));
  });

  it("booked: no suggestion", () => {
    const l = lead({ last_outbound_at: daysBefore(2) });
    const t = deriveTemperature(l, STAGES, NOW, { firstTouchAt: daysBefore(11), bookedAt: daysBefore(3) });
    expect(t.suggestion).toBeUndefined();
    expect(t.reason).not.toContain("Unbooked");
  });

  it("missing firstTouchAt: no suggestion", () => {
    const t = deriveTemperature(lead({ last_outbound_at: daysBefore(2) }), STAGES, NOW, { bookedAt: null });
    expect(t.suggestion).toBeUndefined();
  });

  it("a manual temperature still wins, with no suggestion", () => {
    const t = deriveTemperature(lead({ temperature: "hot" }), STAGES, NOW, { firstTouchAt: daysBefore(30) });
    expect(t).toEqual({ level: "hot", reason: "Manually set", overridden: true });
    expect(t.suggestion).toBeUndefined();
  });

  it("a nurture-stage lead keeps 'Nurture stage' and gets no suggestion", () => {
    const t = deriveTemperature(lead({ current_stage_id: "s-nurture" }), STAGES, NOW, {
      firstTouchAt: daysBefore(30),
      sequenceEndedNoReplyAt: daysBefore(5),
    });
    expect(t).toEqual({ level: "cold", reason: "Nurture stage", overridden: false });
  });

  it("an unanswered reply is still hot, with no suggestion (rule 1 wins)", () => {
    const t = deriveTemperature(lead({ last_inbound_at: daysBefore(1) }), STAGES, NOW, { firstTouchAt: daysBefore(30) });
    expect(t.level).toBe("hot");
    expect(t.suggestion).toBeUndefined();
  });
});
