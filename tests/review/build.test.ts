import { describe, expect, it } from "vitest";
import { buildReviewRows, civilDateIn, earliestTasks, reviewLeadStageIds, type ReviewInput } from "@/lib/review/build";

const NOW = new Date("2026-11-02T15:00:00Z");
const matter = (over: Record<string, unknown> = {}) => ({
  id: "m1", matter_number: "TM-1", title: "Acme mark", mark_text: "ACME", owner_name: "Acme Inc", status: "open", lead_id: null, assigned_to: "u1",
  stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-01-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null,
  stage: { code: "10", label: "Application Filed", is_open: true, waiting_on: "firm", order_index: 5 }, ...over,
});
const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1", first_name: "Jo", last_name: "Lee", business_name: null, email: "jo@x.com", mark_text: null, current_stage_id: "s2", assigned_to: null,
  stage_entered_at: "2026-10-25T00:00:00Z", created_at: "2026-10-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null, sheet_key: null, ...over,
});
const stages = [
  { id: "s1", name: "Potential New Client", category: "open", order_index: 1 },
  { id: "s2", name: "Consultation Scheduled", category: "open", order_index: 2 },
  { id: "s3", name: "Follow-Up", category: "open", order_index: 3 },
  { id: "s4", name: "Signed", category: "won", order_index: 4 },
];
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  matters: [matter()] as never, leads: [lead()] as never, leadStages: stages, tasks: [], activity: [], deadlines: [], lastStageChange: new Map(),
  pendingMatterIds: new Set(), pendingLeadIds: new Set(), sources: { activity: "ok", deadlines: "ok" }, timeZone: "America/New_York", now: NOW, ...over,
});

describe("reviewLeadStageIds", () => {
  it("open stages except new-enquiry and follow-up", () => {
    expect([...reviewLeadStageIds(stages)]).toEqual(["s2"]);
  });
});

describe("earliestTasks", () => {
  it("picks the soonest due, undated last", () => {
    const m = earliestTasks(
      [
        { id: "a", title: "late", due_at: "2026-12-01T00:00:00Z", assignee_id: null, matter_id: "m1", lead_id: null },
        { id: "b", title: "soon", due_at: "2026-11-03T00:00:00Z", assignee_id: "u1", matter_id: "m1", lead_id: null },
        { id: "c", title: "none", due_at: null, assignee_id: null, matter_id: "m1", lead_id: null },
      ],
      "matter_id",
    );
    expect(m.get("m1")).toEqual({ id: "b", title: "soon", dueDate: "2026-11-03", assigneeId: "u1" });
  });
});

describe("buildReviewRows", () => {
  it("builds a matter and a lead row; USPTO stage waits on the USPTO", () => {
    const rows = buildReviewRows(base());
    expect(rows.map((r) => r.key)).toEqual(["m-m1", "l-l1"]);
    expect(rows[0].waiting).toBe("uspto");
    expect(rows[0].client).toBe("Acme Inc");
    expect(rows[1].client).toBe("Jo Lee");
    expect(rows[1].assignedTo).toBeNull();
  });
  it("skips closed matters, ineligible lead stages and leads that have a matter", () => {
    const rows = buildReviewRows(base({
      matters: [matter({ status: "closed" }), matter({ id: "m2", lead_id: "l1" })] as never,
      leads: [lead(), lead({ id: "l2", current_stage_id: "s1" }), lead({ id: "l3", current_stage_id: "s4" })] as never,
    }));
    expect(rows.map((r) => r.key)).toEqual(["m-m2"]);
  });
  it("last contact and direction come from the timeline in the firm's zone", () => {
    const rows = buildReviewRows(base({ activity: [
      { lead_id: "l1", matter_id: null, type: "email_received", created_at: "2026-10-31T02:00:00Z" },
      { lead_id: "l1", matter_id: null, type: "note", created_at: "2026-10-20T10:00:00Z" },
    ] }));
    const l = rows.find((r) => r.kind === "lead")!;
    expect(l.lastContact).toEqual({ date: "2026-10-30", type: "email_received" });
    expect(l.waiting).toBe("us");
  });
  it("a failed activity read is unknown, not none", () => {
    const rows = buildReviewRows(base({ sources: { activity: "unavailable", deadlines: "ok" } }));
    expect(rows.every((r) => !r.contactKnown && r.lastContact === null && r.waiting !== "us" && r.waiting !== "client")).toBe(true);
  });
  it("pending approvals chip a lead; a null set skips the chip", () => {
    expect(buildReviewRows(base({ pendingLeadIds: new Set(["l1"]) })).find((r) => r.kind === "lead")!.waiting).toBe("approval");
    expect(buildReviewRows(base({ pendingLeadIds: null })).find((r) => r.kind === "lead")!.waiting).toBeNull();
  });
  it("nearest open deadline; pipeline order puts matters after leads", () => {
    const rows = buildReviewRows(base({ deadlines: [
      { matter_id: "m1", due_date: "2026-12-10", title: "B" }, { matter_id: "m1", due_date: "2026-11-20", title: "A" },
    ] }));
    expect(rows[0].deadline).toEqual({ dueDate: "2026-11-20", title: "A" });
    expect(rows[0].stageOrder!).toBeGreaterThan(rows[1].stageOrder!);
  });
  it("civilDateIn uses the zone", () => {
    expect(civilDateIn("2026-11-02T02:00:00Z", "America/New_York")).toBe("2026-11-01");
  });
});
