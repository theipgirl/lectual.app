import { describe, expect, it } from "vitest";
import {
  LEAD_CREATE_CAP,
  SYNC_CUTOFF_FLOOR,
  createdDates,
  isHiredProspect,
  nextLastSync,
  planProspectSync,
  syncCutoff,
  type ProspectCandidate,
  type SyncLead,
} from "@/lib/lawmatics/prospect-sync-plan";
import type { PlanStage } from "@/lib/lawmatics/import-plan";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { stageAgeDisplay } from "@/lib/lifecycle/stage-age";

/** Invented people only. */
const STAGES: PlanStage[] = [
  { id: "s-new", name: "Potential New Client", category: "open", orderIndex: 1 },
  { id: "s-consult", name: "Consult Scheduled", category: "open", orderIndex: 2 },
  { id: "s-won", name: "Signed LOE / Deposit Received", category: "won", orderIndex: 9 },
  { id: "s-lost", name: "Lost", category: "lost", orderIndex: 10 },
  { id: "s-nurture", name: "Long-Term Nurture", category: "nurture", orderIndex: 11 },
];

const rec = (id: string, over: Partial<LawmaticsSourceRecord> = {}): LawmaticsSourceRecord => ({
  lawmaticsId: id,
  matterName: null,
  firstName: "Wren",
  lastName: `Tester${id}`,
  email: `wren${id}@example.test`,
  phone: null,
  businessName: null,
  website: null,
  stageName: null,
  practiceArea: "Trademark",
  createdAt: "2026-11-10T15:00:00.000Z",
  updatedAt: null,
  contactId: null,
  referralSource: null,
  origin: { source: null, detail: null } as never,
  ...over,
});
const cand = (r: LawmaticsSourceRecord, over: Partial<ProspectCandidate> = {}): ProspectCandidate => ({ record: r, status: null, convertedDate: null, ...over });
const lead = (id: string, over: Partial<SyncLead> = {}): SyncLead => ({
  id,
  email: `${id}@example.test`,
  first_name: "Ola",
  last_name: "Placeholder",
  phone: null,
  business_name: null,
  website: null,
  current_stage_id: "s-new",
  lawmatics_id: null,
  practice_area: null,
  referral_source: null,
  referral_detail: null,
  merged_into_id: null,
  ...over,
});
const plan = (prospects: ProspectCandidate[], leads: SyncLead[] = [], extra: Partial<Parameters<typeof planProspectSync>[0]> = {}) =>
  planProspectSync({ prospects, stages: STAGES, leads, cutoff: SYNC_CUTOFF_FLOOR, ...extra });

describe("the cutoff (1)", () => {
  it("no stored value, an unreadable one, or before 0118: 2026-11-01", () => {
    expect(syncCutoff({ status: "ok", value: null })).toBe("2026-11-01T00:00:00.000Z");
    expect(syncCutoff({ status: "unavailable" })).toBe(SYNC_CUTOFF_FLOOR);
    expect(syncCutoff({ status: "not-set-up" })).toBe(SYNC_CUTOFF_FLOOR);
    expect(syncCutoff({ status: "ok", value: "garbage" })).toBe(SYNC_CUTOFF_FLOOR);
  });
  it("a stored value: max(Nov 1, value - 2 days)", () => {
    expect(syncCutoff({ status: "ok", value: "2026-11-20T09:00:00.000Z" })).toBe("2026-11-18T09:00:00.000Z");
    expect(syncCutoff({ status: "ok", value: "2026-11-02T09:00:00.000Z" })).toBe(SYNC_CUTOFF_FLOOR);
  });
  it("a prospect before the cutoff, or with no created date, writes nothing", () => {
    const p = plan([cand(rec("1", { createdAt: "2026-10-30T00:00:00Z" })), cand(rec("2", { createdAt: null }))]);
    expect(p.creates).toHaveLength(0);
    expect(p.counts).toMatchObject({ beforeCutoff: 1, noCreatedDate: 1 });
  });
  it("a consult's targeted read ignores the cutoff", () => {
    const p = plan([cand(rec("1", { createdAt: "2026-01-01T00:00:00Z" }))], [], { ignoreCutoff: true });
    expect(p.creates).toHaveLength(1);
  });
});

describe("last successful run (2)", () => {
  it("moves only for a complete step in time with nothing over the cap, to the run's START time", () => {
    const start = "2026-11-23T09:08:00.000Z";
    expect(nextLastSync({ complete: true, inTime: true, overCap: 0, runStartedAt: start })).toBe(start);
    expect(nextLastSync({ complete: true, inTime: true, overCap: 3, runStartedAt: start })).toBeNull();
    expect(nextLastSync({ complete: false, inTime: true, overCap: 0, runStartedAt: start })).toBeNull();
    expect(nextLastSync({ complete: true, inTime: false, overCap: 0, runStartedAt: start })).toBeNull();
  });
});

describe("matching (3, 4, 9)", () => {
  it("a lead that already has the Lawmatics id: nothing written", () => {
    const p = plan([cand(rec("7"))], [lead("L1", { lawmatics_id: "7", email: "wren7@example.test" })]);
    expect(p.creates).toHaveLength(0);
    expect(p.links).toHaveLength(0);
    expect(p.counts.unchanged).toBe(1);
  });
  it("one unlinked open-stage lead with the same email and a matching or blank name: links the id ONLY (field changes ignored)", () => {
    const same = plan([cand(rec("7", { phone: "555 0100" }))], [lead("L1", { email: "wren7@example.test", first_name: "Wren", last_name: "Tester7" })]);
    expect(same.links).toEqual([{ leadId: "L1", lawmaticsId: "7" }]);
    expect(Object.keys(same.links[0]).sort()).toEqual(["lawmaticsId", "leadId"]);
    const blank = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "", last_name: "" })]);
    expect(blank.links).toHaveLength(1);
  });
  it("a differently named lead, two leads, or a lead linked to another id: skipped", () => {
    expect(plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "Other", last_name: "Person" })]).links).toHaveLength(0);
    const two = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test" }), lead("L2", { email: "wren7@example.test" })]);
    expect(two.links).toHaveLength(0);
    expect(two.creates).toHaveLength(0);
    expect(two.counts.needALook).toBe(1);
    const other = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "Wren", last_name: "Tester7", lawmatics_id: "99" })]);
    expect(other.links).toHaveLength(0);
    expect(other.creates).toHaveLength(0);
  });
  it("no email, no name: skipped and counted. Two prospects with one email: one create", () => {
    const p = plan([cand(rec("1", { email: null })), cand(rec("2", { firstName: null, lastName: null })), cand(rec("3", { email: "shared@example.test" })), cand(rec("4", { email: "shared@example.test" }))]);
    expect(p.creates.map((c) => c.lawmaticsId)).toEqual(["3"]);
    expect(p.counts.needALook).toBe(3);
  });
});

describe("came back (5)", () => {
  for (const [stage, category] of [["s-lost", "lost"], ["s-won", "won"], ["s-nurture", "nurture"]] as const) {
    it(`a ${category} lead with the email: linked (id only when it had none), stage untouched, one came_back row`, () => {
      const p = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "Wren", last_name: "Tester7", current_stage_id: stage })]);
      expect(p.cameBack).toEqual([{ leadId: "L1", lawmaticsId: "7", category, writeId: true }]);
      expect(p.creates).toHaveLength(0);
      expect(p.links).toHaveLength(0);
    });
  }
  it("a lead already linked to an older Lawmatics record keeps its id (no id write) and is still flagged", () => {
    const p = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "Wren", last_name: "Tester7", lawmatics_id: "old", current_stage_id: "s-won" })]);
    expect(p.cameBack).toEqual([{ leadId: "L1", lawmaticsId: "7", category: "won", writeId: false }]);
  });
  it("a merged lead is followed to its keeper", () => {
    const p = plan(
      [cand(rec("7"))],
      [lead("K", { email: "keeper@example.test", first_name: "", last_name: "", current_stage_id: "s-lost" }), lead("M", { email: "wren7@example.test", merged_into_id: "K" })],
    );
    expect(p.cameBack.map((c) => c.leadId)).toEqual(["K"]);
  });
  it("a contradicting name, or two leads with the email: the importer's skip, no flag", () => {
    expect(plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", first_name: "Zed", last_name: "Other", current_stage_id: "s-lost" })]).cameBack).toHaveLength(0);
    expect(
      plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", current_stage_id: "s-lost" }), lead("L2", { email: "wren7@example.test", current_stage_id: "s-new" })]).cameBack,
    ).toHaveLength(0);
  });
  it("the stage is never moved: the plan has no stage field for an existing lead", () => {
    const p = plan([cand(rec("7"))], [lead("L1", { email: "wren7@example.test", current_stage_id: "s-lost" })]);
    expect(JSON.stringify(p.cameBack)).not.toMatch(/stage_id|stageId/);
  });
});

describe("hired, includes, source, contacts (6, 10, 11)", () => {
  it("hired by status, by converted_date or by a hired stage name: left for the hired sync", () => {
    expect(isHiredProspect(cand(rec("1"), { status: "Hired" }))).toBe(true);
    expect(isHiredProspect(cand(rec("1"), { convertedDate: "2026-11-11" }))).toBe(true);
    expect(isHiredProspect(cand(rec("1", { stageName: "Hired" })))).toBe(true);
    const p = plan([cand(rec("1"), { status: "hired" }), cand(rec("2"), { convertedDate: "2026-11-11" }), cand(rec("3", { stageName: "Hired Client" }))]);
    expect(p.creates).toHaveLength(0);
    expect(p.counts.leftForHired).toBe(3);
  });
  it("never a won, lost or nurture target; a firm with no open stage gets nothing", () => {
    for (let i = 0; i < 40; i++) {
      const p = plan([cand(rec(String(i), { stageName: ["Hired", "Lost", "Nurture", "Proposal Sent", null][i % 5] }))]);
      for (const c of p.creates) expect(["s-won", "s-lost", "s-nurture"]).not.toContain(c.stageId);
    }
    const none = planProspectSync({ prospects: [cand(rec("1"))], stages: STAGES.filter((s) => s.category !== "open"), leads: [], cutoff: SYNC_CUTOFF_FLOOR });
    expect(none.creates).toHaveLength(0);
    expect(none.counts.needALook).toBe(1);
  });
  it("the source comes from the record's origin; nothing known stays blank, never 'Lawmatics'", () => {
    const known = plan([cand(rec("1", { origin: { source: "Event", detail: "UGW 2026" } as never }))]);
    expect(known.creates[0].fields).toMatchObject({ referral_source: "Event", referral_detail: "UGW 2026" });
    const unknown = plan([cand(rec("2"))]);
    expect(unknown.creates[0].fields.referral_source).toBeNull();
    expect(JSON.stringify(unknown.creates[0].fields)).not.toContain("Lawmatics");
  });
});

describe("stage age (8)", () => {
  it("created_at and last_activity_at = the Lawmatics date; a future or unreadable one is not written", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    expect(createdDates("2026-11-10T15:00:00.000Z", now)).toEqual({ created_at: "2026-11-10T15:00:00.000Z", last_activity_at: "2026-11-10T15:00:00.000Z" });
    expect(createdDates("2027-01-01T00:00:00Z", now)).toEqual({});
    expect(createdDates(null, now)).toEqual({});
  });
  it("with lawmatics_synced_at null and stage_entered_at = the run time, the card reads '0d in stage'", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    // The lead carries an import marker (lawmatics_id), but its stage date is the run time, not created or synced.
    const shown = stageAgeDisplay({ stageEnteredAt: "2026-11-23T09:08:00.000Z", createdAt: "2026-11-10T15:00:00.000Z", importedAt: null, imported: true, lastStageChangeAt: null, now });
    expect(shown.label).toBe("0d in stage");
    expect(shown.sinceImport).toBe(false);
  });
});

describe("caps (12)", () => {
  it(`over ${LEAD_CREATE_CAP} creates: ${LEAD_CREATE_CAP} planned, the rest counted`, () => {
    const p = plan(Array.from({ length: 60 }, (_, i) => cand(rec(String(i)))));
    expect(p.creates).toHaveLength(50);
    expect(p.counts.overCap).toBe(10);
    expect(nextLastSync({ complete: true, inTime: true, overCap: p.counts.overCap, runStartedAt: "x" })).toBeNull();
  });
  it("creates already used this run (targeted reads) share the cap", () => {
    expect(plan([cand(rec("1"))], [], { createsUsed: 50 }).creates).toHaveLength(0);
  });
  it("contacts with no prospect are never part of the plan", () => {
    const p = plan([cand(rec("1"))]);
    expect(p.counts.contactsDropped).toBe(0);
    expect(Object.keys(p)).not.toContain("contactCreates");
  });
});
