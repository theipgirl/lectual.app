import { describe, expect, it } from "vitest";
import { row, TODAY } from "./fixtures";
import { buildReviewRows, type ReviewInput } from "@/lib/review/build";
import { laneLabel, laneLoad, laneLoadText, type Lane } from "@/lib/review/lanes";
import { cardSubline, sentText } from "@/lib/review/format";
import { matchesSearch } from "@/lib/review/params";

const step = (dueDate: string | null) => ({ id: "t", title: "Follow up", dueDate, assigneeId: null });
const lane = (our: ReturnType<typeof row>[], client: ReturnType<typeof row>[] = []): Lane => ({ userId: "u", name: "Rayn", our, client, count: our.length + client.length });

describe("how much each person holds (pure)", () => {
  it("counts every card in the lane, split into overdue and due this week", () => {
    const l = lane(
      [row({ key: "a", nextStep: step("2026-10-30") }), row({ key: "b", nextStep: step("2026-11-02") }), row({ key: "c", nextStep: step("2026-11-05") }), row({ key: "d", nextStep: null })],
      [row({ key: "e", waiting: "client", nextStep: step("2026-10-01") })],
    );
    expect(laneLoad(l, TODAY)).toEqual({ total: 5, overdue: 2, week: 2 });
    expect(laneLoadText(laneLoad(l, TODAY))).toBe("2 overdue · 2 due this week");
    expect(laneLabel("Rayn", laneLoad(l, TODAY))).toBe("Rayn · 5, 2 overdue · 2 due this week");
  });
  it("says nothing extra when nothing is overdue or due, and an empty lane is zero", () => {
    const l = lane([row({ key: "a", nextStep: step("2026-12-30") })]);
    expect(laneLoadText(laneLoad(l, TODAY))).toBeNull();
    expect(laneLabel("Rayn", laneLoad(l, TODAY))).toBe("Rayn · 1");
    expect(laneLoad(lane([]), TODAY)).toEqual({ total: 0, overdue: 0, week: 0 });
  });
  it("one of each reads singular-free: counts, not plurals", () => {
    expect(laneLoadText({ total: 2, overdue: 1, week: 1 })).toBe("1 overdue · 1 due this week");
  });
});

describe("the card's timeline line: the newest thing sent out", () => {
  it("is a date like 'Nov 11' and what it was", () => {
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-11", lastOutboundType: "email_sent" }, "2026-11-17")).toBe("Sent Nov 11 · email");
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-11", lastOutboundType: "call_logged" }, "2026-11-17")).toBe("Sent Nov 11 · call");
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-11" }, "2026-11-17")).toBe("Sent Nov 11");
  });
  it("adds the days for a Waiting-on-client card", () => {
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-11", lastOutboundType: "email_sent" }, "2026-11-17", { days: true })).toBe("Sent Nov 11 · email · 6 days");
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-16", lastOutboundType: "email_sent" }, "2026-11-17", { days: true })).toBe("Sent Nov 16 · email · 1 day");
    expect(sentText({ contactKnown: true, lastOutbound: "2026-11-17", lastOutboundType: "email_sent" }, "2026-11-17", { days: true })).toBe("Sent Nov 17 · email · today");
  });
  it("keeps three states: nothing sent, and a history that could not be read", () => {
    expect(sentText({ contactKnown: true, lastOutbound: null }, TODAY)).toBe("Nothing sent yet");
    expect(sentText({ contactKnown: false, lastOutbound: null }, TODAY)).toBe("Sent: couldn't load");
  });
});

const NOW = new Date("2026-11-17T15:00:00Z");
const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1", first_name: "Anthony", last_name: "Harris", business_name: "Harris Holdings LLC", email: "a@x.com", mark_text: "HARRIS", current_stage_id: "s2", assigned_to: null,
  stage_entered_at: "2026-10-25T00:00:00Z", created_at: "2026-10-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null, sheet_key: null, ...over,
});
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  matters: [], leads: [lead()] as never, leadStages: [{ id: "s1", name: "Potential New Client", category: "open", order_index: 1 }, { id: "s2", name: "Consultation Scheduled", category: "open", order_index: 2 }], tasks: [], activity: [], deadlines: [],
  lastStageChange: new Map(), pendingMatterIds: new Set(), pendingLeadIds: new Set(), sources: { activity: "ok", deadlines: "ok" }, timeZone: "America/New_York", now: NOW, ...over,
});

describe("lead labels: the person first, company and mark as the sub-line", () => {
  it("a lead with a name and a company is the person's name, company in the sub-line", () => {
    const [r] = buildReviewRows(input());
    expect(r.client).toBe("Anthony Harris");
    expect(r.company).toBe("Harris Holdings LLC");
    expect(cardSubline(r)).toBe("Lead · Harris Holdings LLC · HARRIS · Consultation Scheduled");
  });
  it("the company stands in only when there is no person's name, and is then not repeated", () => {
    const [r] = buildReviewRows(input({ leads: [lead({ first_name: null, last_name: null })] as never }));
    expect(r.client).toBe("Harris Holdings LLC");
    expect(r.company).toBeNull();
    expect(cardSubline(r)).toBe("Lead · HARRIS · Consultation Scheduled");
  });
  it("a company equal to the name is not repeated; no name at all falls to the email", () => {
    const [same] = buildReviewRows(input({ leads: [lead({ business_name: "anthony harris" })] as never }));
    expect(same.company).toBeNull();
    const [none] = buildReviewRows(input({ leads: [lead({ first_name: null, last_name: null, business_name: null })] as never }));
    expect(none.client).toBe("a@x.com");
  });
  it("search finds a lead by its company as well as its name and mark", () => {
    const [r] = buildReviewRows(input());
    for (const q of ["anthony", "holdings", "harris"]) expect(matchesSearch(r, q)).toBe(true);
    expect(matchesSearch(r, "zzz")).toBe(false);
  });
});

describe("the newest outbound contact carries what it was", () => {
  it("is the newest email we sent or call we logged, not a reply or a note", () => {
    const [r] = buildReviewRows(input({ activity: [
      { lead_id: "l1", matter_id: null, type: "email_sent", created_at: "2026-11-05T15:00:00Z" },
      { lead_id: "l1", matter_id: null, type: "call_logged", created_at: "2026-11-11T16:00:00Z" },
      { lead_id: "l1", matter_id: null, type: "email_received", created_at: "2026-11-14T16:00:00Z" },
      { lead_id: "l1", matter_id: null, type: "note", created_at: "2026-11-15T16:00:00Z" },
    ] }));
    expect(r.lastOutbound).toBe("2026-11-11");
    expect(r.lastOutboundType).toBe("call_logged");
  });
  it("is null when nothing was sent, and unknown (not none) when the activity read failed", () => {
    const [none] = buildReviewRows(input());
    expect(none.lastOutbound).toBeNull();
    expect(none.contactKnown).toBe(true);
    const [failed] = buildReviewRows(input({ sources: { activity: "unavailable", deadlines: "ok" } }));
    expect(failed.contactKnown).toBe(false);
    expect(failed.lastOutboundType).toBeNull();
  });
});
