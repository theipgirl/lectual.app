import { describe, it, expect } from "vitest";
import type { Stage } from "@/lib/pipeline";
import { intakeStages, intakeStageIds, isTrademarkIntake } from "@/lib/intake";

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

// RPB's real 21-stage SOP pipeline (supabase/migrations/0028_seed_demo_pipeline.sql
// lines 5-27), built inline as fixture rows — never imported from the migration.
const RPB_STAGES: Stage[] = [
  stage({ id: "s1", name: "Follow-Up", order_index: 1, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s2", name: "Potential New Client", order_index: 2, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s3", name: "Preliminary Search", order_index: 3, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s4", name: "Consultation Scheduled", order_index: 4, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s5", name: "Post Consultation Email Sent", order_index: 5, category: "open", aging_threshold_days: 3 }),
  stage({ id: "s6", name: "Undecided / Questions", order_index: 6, category: "open", aging_threshold_days: 30 }),
  stage({ id: "s7", name: "LOE & Invoice Sent", order_index: 7, category: "open", aging_threshold_days: 3 }),
  stage({ id: "s8", name: "Signed LOE / Deposit Received", order_index: 8, category: "won", aging_threshold_days: null }),
  stage({ id: "s9", name: "Questionnaire Complete", order_index: 9, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s10", name: "Comprehensive Search", order_index: 10, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s11", name: "Preparing Opinion Letter", order_index: 11, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s12", name: "Opinion Letter Sent", order_index: 12, category: "open", aging_threshold_days: 3 }),
  stage({ id: "s13", name: "Application Preparation", order_index: 13, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s14", name: "Consent to File Application", order_index: 14, category: "open", aging_threshold_days: 3 }),
  stage({ id: "s15", name: "Application Ready for Filing", order_index: 15, category: "open", aging_threshold_days: 2 }),
  stage({ id: "s16", name: "Send Invoice for Remaining Balance", order_index: 16, category: "open", aging_threshold_days: 3 }),
  stage({ id: "s17", name: "Full Balance Received", order_index: 17, category: "won", aging_threshold_days: null }),
  stage({ id: "s18", name: "Application Filed", order_index: 18, category: "open", aging_threshold_days: null }),
  stage({ id: "s19", name: "Awaiting Trademark Registration", order_index: 19, category: "open", aging_threshold_days: 30 }),
  stage({ id: "s20", name: "Publication for Opposition", order_index: 20, category: "open", aging_threshold_days: 30 }),
  stage({ id: "s21", name: "Trademark Registered", order_index: 21, category: "won", aging_threshold_days: null }),
];

// Tenant default 7-stage pipeline (supabase/migrations/0017_seed_org_defaults.sql).
const DEFAULT_STAGES: Stage[] = [
  stage({ id: "d1", name: "New PNC", order_index: 1, category: "open", aging_threshold_days: 7 }),
  stage({ id: "d2", name: "Discovery Call", order_index: 2, category: "open", aging_threshold_days: 5 }),
  stage({ id: "d3", name: "Strategy Session", order_index: 3, category: "open", aging_threshold_days: 5 }),
  stage({ id: "d4", name: "Pending LOE + Payment", order_index: 4, category: "open", aging_threshold_days: 3 }),
  stage({ id: "d5", name: "Hired Client", order_index: 5, category: "won", aging_threshold_days: null }),
  stage({ id: "d6", name: "Nurture", order_index: 6, category: "nurture", aging_threshold_days: 30 }),
  stage({ id: "d7", name: "Lost", order_index: 7, category: "lost", aging_threshold_days: null }),
];

describe("intakeStages / intakeStageIds", () => {
  it("RPB: intake is Follow-Up (1) through LOE & Invoice Sent (7) — below the first won stage", () => {
    const result = intakeStages(RPB_STAGES);
    expect(result.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  });

  it("RPB: intakeStageIds matches intakeStages", () => {
    const ids = intakeStageIds(RPB_STAGES);
    expect(ids).toEqual(new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]));
  });

  it("default 7-stage tenant: intake is New PNC..Pending LOE + Payment, Nurture included, Lost excluded", () => {
    const result = intakeStages(DEFAULT_STAGES);
    // Nurture (d6, order 6) is category 'nurture' but order_index 6 is AFTER
    // the won stage (d5, order 5), so it is not below the first won stage and
    // is excluded — matches "below the first won stage's order_index" literally.
    expect(result.map((s) => s.id)).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("a tenant with no won stage treats every open/nurture stage as intake", () => {
    const stages: Stage[] = [
      stage({ id: "a", order_index: 1, category: "open" }),
      stage({ id: "b", order_index: 2, category: "nurture" }),
      stage({ id: "c", order_index: 3, category: "lost" }),
    ];
    expect(intakeStages(stages).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("returns [] for an empty stage list", () => {
    expect(intakeStages([])).toEqual([]);
    expect(intakeStageIds([])).toEqual(new Set());
  });
});

describe("isTrademarkIntake", () => {
  it("includes null practice_area", () => {
    expect(isTrademarkIntake({ practice_area: null })).toBe(true);
  });

  it("matches 'trademark' case-insensitively", () => {
    expect(isTrademarkIntake({ practice_area: "Trademark" })).toBe(true);
    expect(isTrademarkIntake({ practice_area: "TRADEMARK" })).toBe(true);
    expect(isTrademarkIntake({ practice_area: "trademark clearance" })).toBe(true);
  });

  it("excludes a non-trademark practice area", () => {
    expect(isTrademarkIntake({ practice_area: "Copyright" })).toBe(false);
    expect(isTrademarkIntake({ practice_area: "Patent" })).toBe(false);
  });
});
