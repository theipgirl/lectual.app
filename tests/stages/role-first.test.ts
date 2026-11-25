import { describe, expect, it } from "vitest";
import { FIRM, HARTWELL, S, H } from "../stage-keeper/fixtures";
import type { StageOpt } from "@/lib/reconcile/types";
import { leadStageWithRole, matterStageWithRole, withRoleFallback, LEAD_STAGE_ROLES, MATTER_STAGE_ROLES } from "@/lib/stages/roles";
import { newEnquiryStage } from "@/lib/pipeline/new-enquiry";
import { stageForSignal, SIGNAL_ROLES } from "@/lib/agents/stage-keeper/mapping";
import { targetStageFromSignals } from "@/lib/agents/stage-keeper/target";
import { stageForMilestone, MILESTONE_ROLES } from "@/lib/reconcile/milestones";
import { wonTargetStage, planHiredSync } from "@/lib/lawmatics/hired-sync-plan";
import { hiredStageOf } from "@/lib/matters/hired-stage";
import { intakeStageIds } from "@/lib/matters/phase-group";
import { firstContactBoundary, followUpStageIds, isPastFirstContact } from "@/lib/intake/working";
import { reviewLeadStageIds } from "@/lib/review/build";
import { compareStatusToStage } from "@/lib/uspto/compare";

/**
 * Stage roles (lectual 0119, spec-editable-views.md 3b rule 4): every rule reads the role first and the name only as the fallback it is
 * today. Three things are pinned: a role survives a rename; with no role (before 0119) every rule gives exactly today's answer; and a
 * role never opens a way into a `won` stage that the rule did not already have.
 */

const rename = (stages: StageOpt[], id: string, name: string, role?: string): StageOpt[] =>
  stages.map((s) => (s.id === id ? { ...s, name, ...(role ? { role } : {}) } : s));
const asEnquiry = (stages: StageOpt[]) => stages.map((s) => ({ id: s.id, name: s.name, category: s.category, order_index: s.orderIndex, role: s.role ?? null }));

describe("the role lists match 0119's CHECKs", () => {
  it("lead and matter roles", () => {
    expect(LEAD_STAGE_ROLES).toEqual(["new_enquiry", "follow_up", "consult_scheduled", "consult_held", "questionnaire_sent", "proposal_sent", "follow_up_sent", "loe_sent", "welcome_sent", "opinion_letter_sent", "signed_loe", "lost"]);
    expect(MATTER_STAGE_ROLES).toEqual(["signed_loe", "application_filed", "oa_issued", "awaiting_registration", "publication", "registered", "abandoned"]);
    // Every signal and every milestone reads a real role.
    for (const r of Object.values(SIGNAL_ROLES)) expect(LEAD_STAGE_ROLES).toContain(r);
    for (const r of Object.values(MILESTONE_ROLES)) expect(LEAD_STAGE_ROLES).toContain(r);
  });
});

describe("leadStageWithRole / matterStageWithRole", () => {
  it("one holder on an allowed category", () => {
    const stages = rename(FIRM, S.pnc, "Fresh", "new_enquiry");
    expect(leadStageWithRole(stages, "new_enquiry")?.id).toBe(S.pnc);
  });
  it("a role on a category it may not sit on is ignored", () => {
    expect(leadStageWithRole(rename(FIRM, S.signed, "X", "new_enquiry"), "new_enquiry")).toBeNull();
    expect(leadStageWithRole(rename(FIRM, S.loe, "X", "signed_loe"), "signed_loe")).toBeNull();
  });
  it("two holders are a guess, not a role", () => {
    const stages = FIRM.map((s) => (s.id === S.pnc || s.id === S.newPnc ? { ...s, role: "new_enquiry" } : s));
    expect(leadStageWithRole(stages, "new_enquiry")).toBeNull();
  });
  it("matter roles keep to open / closed", () => {
    expect(matterStageWithRole([{ id: "a", role: "registered", is_open: false }], "registered")?.id).toBe("a");
    expect(matterStageWithRole([{ id: "a", role: "registered", is_open: true }], "registered")).toBeNull();
    expect(matterStageWithRole([{ id: "a", role: "signed_loe", is_open: false }], "signed_loe")).toBeNull();
  });
  it("withRoleFallback reads again without role only for a missing column", async () => {
    const asked: boolean[] = [];
    const r = await withRoleFallback(async (withRole) => (asked.push(withRole), withRole ? { data: null, error: { code: "42703" } } : { data: [1], error: null }));
    expect(asked).toEqual([true, false]);
    expect(r.data).toEqual([1]);
    asked.length = 0;
    const other = await withRoleFallback(async (withRole) => (asked.push(withRole), { data: null, error: { code: "XX000" } }));
    expect(asked).toEqual([true]);
    expect(other.error).toEqual({ code: "XX000" });
  });
});

describe("new-enquiry stage", () => {
  it("with no role: exactly today's name rule", () => {
    expect(newEnquiryStage(asEnquiry(FIRM))?.id).toBe(S.pnc);
    expect(newEnquiryStage(asEnquiry(HARTWELL))?.id).toBe(H.inquiry);
  });
  it("the role wins over a rename", () => {
    // Renamed away from every alias: by name it would fall back to the FIRST open stage (New PNC); the role keeps it.
    expect(newEnquiryStage(asEnquiry(rename(FIRM, S.pnc, "Just In", "new_enquiry")))?.id).toBe(S.pnc);
    expect(newEnquiryStage(asEnquiry(rename(FIRM, S.pnc, "Just In")))?.id).toBe(S.newPnc);
  });
  it("never a won, lost or nurture stage, whatever its role says", () => {
    for (const id of [S.signed, S.lost, S.nurture]) expect(newEnquiryStage(asEnquiry(rename(FIRM, id, "Z", "new_enquiry")))?.id).toBe(S.pnc);
  });
});

describe("Stage Keeper signals", () => {
  it("with no role: today's names", () => {
    expect(stageForSignal("consult-scheduled", FIRM, {})?.id).toBe(S.consult);
    expect(stageForSignal("loe-invoice-sent", FIRM, {})?.id).toBe(S.loe);
  });
  it("the role wins over a rename", () => {
    const stages = rename(FIRM, S.consult, "Booked call", "consult_scheduled");
    expect(stageForSignal("consult-scheduled", stages, {})?.id).toBe(S.consult);
    expect(stageForSignal("consult-scheduled", rename(FIRM, S.consult, "Booked call"), {})).toBeNull();
  });
  it("a firm brain entry still wins over the role", () => {
    const stages = rename(FIRM, S.consult, "Booked call", "consult_scheduled");
    expect(stageForSignal("consult-scheduled", stages, { "consult-scheduled": "Questionnaire Sent" })?.id).toBe(S.questionnaire);
  });
  it("a role on a won stage never makes the agent move a lead there", () => {
    const stages = FIRM.map((s) => (s.id === S.signed ? { ...s, role: "loe_sent" } : s.id === S.loe ? { ...s, name: "Paper out" } : s));
    const mail = { source: "mail" as const, messageId: "m1", type: "loe-invoice", direction: "outbound" as const, at: "2026-09-20T10:00:00Z", subject: "s", sensitive: false };
    const r = targetStageFromSignals({ currentStageId: S.consult }, [mail], stages, {}, { now: Date.parse("2026-09-25T12:00:00Z") });
    expect(r.kind).not.toBe("move");
  });
});

describe("Reconcile milestones", () => {
  it("with no role: today's names", () => {
    expect(stageForMilestone("proposal_sent", FIRM)?.id).toBe(S.post);
    expect(stageForMilestone("contacted", FIRM)?.id).toBe(S.pnc);
  });
  it("the role wins over a rename; a brain entry wins over the role", () => {
    const stages = rename(FIRM, S.post, "Offer out", "proposal_sent");
    expect(stageForMilestone("proposal_sent", stages)?.id).toBe(S.post);
    expect(stageForMilestone("proposal_sent", rename(FIRM, S.post, "Offer out"))).toBeNull();
    expect(stageForMilestone("proposal_sent", stages, { proposal_sent: "LOE & Invoice Sent" })?.id).toBe(S.loe);
  });
});

describe("hired-matter sync", () => {
  const won = (extra: Array<{ id: string; name: string; category: string; order_index: number; role?: string | null }>) => extra;
  it("with no role: today's name match, else the lowest won", () => {
    const stages = won([
      { id: "w1", name: "Hired", category: "won", order_index: 1 },
      { id: "w2", name: "Signed LOE / Deposit Received", category: "won", order_index: 2 },
    ]);
    expect(wonTargetStage(stages)?.id).toBe("w2");
    expect(wonTargetStage(stages.map((s) => ({ ...s, name: `X${s.id}` })))?.id).toBe("w1");
  });
  it("the signed_loe role on a won stage wins over a rename", () => {
    const stages = won([
      { id: "w1", name: "Hired", category: "won", order_index: 1 },
      { id: "w2", name: "Paid up", category: "won", order_index: 2, role: "signed_loe" },
    ]);
    expect(wonTargetStage(stages)?.id).toBe("w2");
  });
  it("a signed_loe role on an OPEN stage is ignored: the sync never moves a lead to a non-won stage by role", () => {
    const stages = won([
      { id: "o1", name: "Signed LOE / Deposit Received", category: "open", order_index: 1, role: "signed_loe" },
      { id: "w1", name: "Hired", category: "won", order_index: 2 },
    ]);
    expect(wonTargetStage(stages)?.id).toBe("w1");
  });
  it("the matter stage: role first, else the exact label", () => {
    expect(hiredStageOf([{ id: "m1", label: "Signed LOE / Deposit Received" }])?.id).toBe("m1");
    expect(hiredStageOf([{ id: "m1", label: "Engaged" }])).toBeNull();
    expect(hiredStageOf([{ id: "m0", label: "Signed LOE / Deposit Received" }, { id: "m1", label: "Engaged", role: "signed_loe", is_open: true }])?.id).toBe("m1");
  });
  it("the planner files a created TM matter on the role's stage after a rename", () => {
    const plan = planHiredSync({
      prospects: [
        { lawmaticsId: "100", name: "Ada Lovelace", email: "ada@example.com", status: "Hired", convertedDate: "2026-11-02", caseNumber: "77", caseTitle: "ENGINE", trademarkName: null, practiceAreaField: null, practiceAreaName: "Trademark Law" },
      ],
      matters: [],
      leads: [],
      stages: [{ id: "m1", label: "Engaged", role: "signed_loe", is_open: true }],
    });
    expect(plan.create[0]?.stage_id).toBe("m1");
  });
  it("Matters' past-signed-LOE cut follows the role", () => {
    const stages = [
      { id: "a", label: "Consult", order_index: 1, phase: "pipeline" },
      { id: "b", label: "Engaged", order_index: 2, phase: "pipeline", role: "signed_loe", is_open: true },
      { id: "c", label: "Drafting", order_index: 3, phase: "pre_filing" },
    ];
    expect([...intakeStageIds(stages)]).toEqual(["a"]);
    // Without the role, a renamed stage is not found and every pipeline stage stays intake (today's rule).
    expect([...intakeStageIds(stages.map((s) => ({ ...s, role: null })))].sort()).toEqual(["a", "b"]);
  });
});

describe("Working rule and the Weekly review: the Follow-Up boundary", () => {
  const stages = [
    { id: "fu", name: "Follow-Up", category: "open", order_index: 1 },
    { id: "pnc", name: "Potential New Client", category: "open", order_index: 2 },
    { id: "cs", name: "Consultation Scheduled", category: "open", order_index: 3 },
  ];
  it("with no role: names, as today", () => {
    expect([...followUpStageIds(stages)]).toEqual(["fu"]);
    expect(firstContactBoundary(stages)?.stageId).toBe("pnc");
    expect([...reviewLeadStageIds(stages)]).toEqual(["cs"]);
  });
  it("a renamed Follow-Up stage keeps its place through the role", () => {
    const later = [
      { id: "pnc", name: "Potential New Client", category: "open", order_index: 1 },
      { id: "fu", name: "Chasing", category: "open", order_index: 2, role: "follow_up" },
      { id: "cs", name: "Consultation Scheduled", category: "open", order_index: 3 },
    ];
    expect(firstContactBoundary(later)?.stageId).toBe("fu");
    expect(isPastFirstContact("fu", later)).toBe(false);
    expect([...reviewLeadStageIds(later)]).toEqual(["cs"]);
    // Without the role, "Chasing" would count as past first contact.
    const noRole = later.map((s) => ({ ...s, role: null }));
    expect(isPastFirstContact("fu", noRole)).toBe(true);
  });
});

describe("USPTO compare", () => {
  const read = { status: "ok", result: { statusText: "Registered", statusCode: null } } as never;
  it("with no role: the label", () => {
    expect(compareStatusToStage(read, "Registered").verdict).toBe("agree");
    expect(compareStatusToStage(read, "Done and dusted").verdict).toBe("differs");
  });
  it("a renamed stage holding the role still agrees", () => {
    expect(compareStatusToStage(read, "Done and dusted", "registered").verdict).toBe("agree");
    expect(compareStatusToStage(read, "Registered", "abandoned").verdict).toBe("differs");
  });
});
