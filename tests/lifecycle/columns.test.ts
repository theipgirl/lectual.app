import { describe, it, expect } from "vitest";
import { filterCards, groupColumns, leadColumn, mapDocketStages, mapLeadStages, matterColumn, type PipelineCard } from "@/lib/lifecycle/columns";

const st = (id: string, code: string, label: string, order_index: number, is_open = true) => ({ id, code, label, order_index, is_open });

describe("docket stage → pipeline column", () => {
  it("maps the default 12-stage catalogue", () => {
    const m = mapDocketStages([
      st("1", "ENGAGED", "Engaged", 10),
      st("2", "SEARCH", "Clearance search", 20),
      st("3", "PREP", "Application preparation", 30),
      st("4", "CLIENT_REVIEW", "Client review", 40),
      st("5", "FILED", "Filed, awaiting examination", 50),
      st("6", "OA", "Office action received", 60),
      st("7", "OA_RESPONDED", "Office action response filed", 70),
      st("8", "PUBLISHED", "Published for opposition", 80),
      st("9", "ALLOWED", "Allowed / statement of use", 90),
      st("10", "REGISTERED", "Registered", 100, false),
      st("11", "ABANDONED", "Abandoned", 110, false),
      st("12", "CLOSED", "Closed / not moving forward", 120, false),
    ]);
    expect([...m.values()]).toEqual(["engaged", "engaged", "engaged", "engaged", "filed", "office", "office", "filed", "filed", "registered", "closed", "closed"]);
  });

  it("maps a firm's own names (RPB-style numbering), inheriting across unnamed steps", () => {
    const m = mapDocketStages([
      st("a", "1", "Potential New Client", 1),
      st("b", "3", "Consultation Scheduled", 3),
      st("c", "5", "Undecided/Questions", 5),
      st("d", "7", "Signed LOE / Deposit Received", 7),
      st("e", "12", "Application Preparation", 12),
      st("f", "17", "Application Filed", 17),
      st("g", "19A", "OA Issued", 19),
      st("h", "19D", "Invoice for OA Response Sent", 20),
      st("i", "20A", "Specimen(s) Requested", 21),
      st("j", "20B", "Invoice for SOU Sent", 22),
      st("k", "21A", "NOA Issued", 23),
      st("l", "24", "Trademark Registered", 30, false),
      st("m", "26", "No Longer Moving Forward", 31, false),
    ]);
    expect(Object.fromEntries(m)).toEqual({
      a: "intake", b: "consult", c: "consult", d: "engaged", e: "engaged", f: "filed", g: "office", h: "office", i: "filed", j: "filed", k: "filed", l: "registered", m: "closed",
    });
  });

  it("falls back to engaged when nothing earlier matched", () => {
    const m = mapDocketStages([st("x", "A", "Kickoff", 1), st("y", "B", "Drafting", 2)]);
    expect([...m.values()]).toEqual(["engaged", "engaged"]);
  });

  it("places matters: no stage = engaged, closed = closed, registration date wins", () => {
    const m = mapDocketStages([st("f", "F", "Filed", 1), st("x", "X", "Closed", 2, false)]);
    expect(matterColumn(m, { stage_id: null, status: "open", registration_date: null })).toBe("engaged");
    expect(matterColumn(m, { stage_id: "f", status: "closed", registration_date: null })).toBe("closed");
    expect(matterColumn(m, { stage_id: "f", status: "open", registration_date: "2026-01-01" })).toBe("registered");
    expect(matterColumn(m, { stage_id: "x", status: "closed", registration_date: "2026-01-01" })).toBe("closed");
  });
});

describe("lead stage → pipeline column", () => {
  const stages = [
    { id: "new", name: "Inquiry", category: "open", order_index: 1 },
    { id: "nur", name: "Nurture", category: "nurture", order_index: 2 },
    { id: "call", name: "Discovery call booked", category: "open", order_index: 3 },
    { id: "prop", name: "Proposal out", category: "open", order_index: 4 },
    { id: "won", name: "Retained", category: "won", order_index: 5 },
    { id: "lost", name: "Went elsewhere", category: "lost", order_index: 6 },
    { id: "park", name: "Nurture (later)", category: "nurture", order_index: 7 },
  ];
  it("uses category and order, with the first consult-like stage as the consult boundary", () => {
    const m = mapLeadStages(stages);
    const col = (id: string, note = false) => leadColumn(m, { current_stage_id: id }, note);
    expect([col("new"), col("nur"), col("call"), col("prop"), col("won"), col("lost"), col("park")]).toEqual(["intake", "intake", "consult", "consult", "engaged", "closed", "intake"]);
  });
  it("a consult note moves an early lead to consult; a firm with no consult-named stage relies on notes", () => {
    const m = mapLeadStages([{ id: "a", name: "Stage A", category: "open", order_index: 1 }, { id: "w", name: "Stage W", category: "won", order_index: 2 }]);
    expect(leadColumn(m, { current_stage_id: "a" }, false)).toBe("intake");
    expect(leadColumn(m, { current_stage_id: "a" }, true)).toBe("consult");
    expect(leadColumn(m, { current_stage_id: "unknown" }, false)).toBe("intake");
  });
});

describe("filters and grouping", () => {
  const card = (p: Partial<PipelineCard>): PipelineCard => ({
    key: Math.random().toString(), kind: "matter", column: "filed", client: "Acme", mark: "ACME", ref: "TM-1", stageLabel: null, ageDays: 3, ownerId: null, ownerName: null, href: "#", ...p,
  });
  it("searches client/mark/ref and filters by owner (including none)", () => {
    const cards = [card({ client: "Blue Fern LLC", ownerId: "u1" }), card({ mark: "ORCHID", ownerId: "u2" }), card({ ref: "TM-77" })];
    expect(filterCards(cards, { q: "fern" })).toHaveLength(1);
    expect(filterCards(cards, { q: "orchid" })).toHaveLength(1);
    expect(filterCards(cards, { owner: "u1" })).toHaveLength(1);
    expect(filterCards(cards, { owner: "none" })).toHaveLength(1);
  });
  it("groups into every column (empty ones included), oldest in stage first", () => {
    const cols = groupColumns([card({ ageDays: 1 }), card({ ageDays: 9 }), card({ column: "intake", ageDays: null })]);
    expect(cols.map((c) => c.column)).toEqual(["intake", "consult", "engaged", "filed", "office", "registered", "closed"]);
    expect(cols.find((c) => c.column === "filed")!.cards.map((c) => c.ageDays)).toEqual([9, 1]);
    expect(cols.find((c) => c.column === "consult")!.count).toBe(0);
  });
});
