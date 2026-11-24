import { describe, expect, it } from "vitest";
import { buildReviewRows, earliestOfficeAction, type ReviewInput } from "@/lib/review/build";
import { reviewBuckets, type ReviewRow } from "@/lib/review/buckets";
import { boardLanes, laneOf, placeOnBoard } from "@/lib/review/lanes";
import { buildDeck } from "@/lib/review/deck";
import { deadlinesOut, proposalsOut, waitingOnPerson } from "@/lib/review/strips";
import { factCells } from "@/lib/review/sheet-cells";
import * as W from "@/lib/ui/words";

const NOW = new Date("2026-11-02T15:00:00Z");
const TODAY = "2026-11-02";
const matter = (over: Record<string, unknown> = {}) => ({
  id: "m1", matter_number: "TM-1", title: "Northwind Tea", mark_text: "NORTHWIND", owner_name: "Northwind Tea LLC", status: "open", lead_id: null, assigned_to: "u1",
  stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-01-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null, type: "TM", serial_number: "99000001",
  opened_at: "2026-03-05T02:30:00Z",
  stage: { code: "10", label: "Application Filed", is_open: true, waiting_on: "uspto", order_index: 5 }, ...over,
});
const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1", first_name: "Jo", last_name: "Lee", business_name: "Acme Studio", email: "jo@example.com", mark_text: null, current_stage_id: "s2", assigned_to: null,
  stage_entered_at: "2026-10-25T00:00:00Z", created_at: "2026-10-01T03:00:00Z", lawmatics_id: null, lawmatics_synced_at: null, sheet_key: null, ...over,
});
const stages = [{ id: "s1", name: "Potential New Client", category: "open", order_index: 1 }, { id: "s2", name: "Consultation Scheduled", category: "open", order_index: 2 }];
const deadline = (over: Record<string, unknown> = {}) => ({ matter_id: "m1", id: "d1", kind: "office_action_response", due_date: "2026-11-20", title: null, attorney_confirmed: true, ...over });
const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  matters: [matter()] as never, leads: [lead()] as never, leadStages: stages, tasks: [], activity: [], deadlines: [], lastStageChange: new Map(),
  pendingMatterIds: new Set(), pendingLeadIds: new Set(), sources: { activity: "ok", deadlines: "ok" }, timeZone: "America/New_York", now: NOW, ...over,
});
const matterRow = (input: ReviewInput) => buildReviewRows(input).find((r) => r.kind === "matter")!;
const leadRow = (input: ReviewInput) => buildReviewRows(input).find((r) => r.kind === "lead")!;

describe("serial, start day, practice area, lead reads absent", () => {
  it("a matter carries its serial number, its type's label and the firm day it was opened", () => {
    const r = matterRow(base());
    expect(r.serialNumber).toBe("99000001");
    expect(r.practiceArea).toBe("Trademark (TM)");
    // 02:30Z on Mar 5 is still Mar 4 in New York: the firm's day, not the UTC day.
    expect(r.startDate).toBe("2026-03-04");
  });
  it("start date falls back to created_at when opened_at is absent", () => {
    expect(matterRow(base({ matters: [matter({ opened_at: null })] as never })).startDate).toBe("2025-12-31");
  });
  it("a blank serial is none recorded; an unknown type has no practice area", () => {
    const r = matterRow(base({ matters: [matter({ serial_number: "  ", type: null })] as never }));
    expect(r.serialNumber).toBeNull();
    expect(r.practiceArea).toBeNull();
  });
  it("a lead has a start day (created_at, firm day) and no serial, practice area or office action", () => {
    const r = leadRow(base());
    expect(r.startDate).toBe("2026-09-30");
    expect(r.serialNumber).toBeUndefined();
    expect(r.practiceArea).toBeUndefined();
    expect(r.officeActionDue).toBeUndefined();
    const cells = factCells(r, TODAY);
    expect(cells.serial.text).toBe("—");
    expect(cells.practiceArea.text).toBe("—");
    expect(cells.oaDue).toEqual({ text: "—", tone: "none" });
    expect(cells.start.text).toBe("Sep 30");
  });
  it("a BL matter reads the label of its own type", () => {
    expect(matterRow(base({ matters: [matter({ type: "BL" })] as never })).practiceArea).toBe("Business law (BL)");
  });
});

describe("office action due date", () => {
  it("earliest office_action_response", () => {
    const r = matterRow(base({ deadlines: [deadline({ id: "a", due_date: "2026-12-01" }), deadline({ id: "b", due_date: "2026-11-10" })] as never }));
    expect(r.officeActionDue).toEqual({ dueDate: "2026-11-10", confirmed: true });
  });
  it("statement_of_use ignored", () => {
    const r = matterRow(base({ deadlines: [deadline({ kind: "statement_of_use", due_date: "2026-11-05" }), deadline({ id: "b", due_date: "2026-12-01" })] as never }));
    expect(r.officeActionDue?.dueDate).toBe("2026-12-01");
    expect(matterRow(base({ deadlines: [deadline({ kind: "statement_of_use" })] as never })).officeActionDue).toBeNull();
    expect(earliestOfficeAction([])).toBeNull();
  });
  it("no open office action reads null (a dash), not a failure", () => {
    const r = matterRow(base());
    expect(r.officeActionDue).toBeNull();
    expect(factCells(r, TODAY).oaDue).toEqual({ text: "—", tone: "none" });
  });
  it("lead is absent", () => {
    expect("officeActionDue" in leadRow(base({ deadlines: [deadline()] as never }))).toBe(false);
  });
  it("unconfirmed marker text is exactly the words.ts string appended to the date", () => {
    const r = matterRow(base({ deadlines: [deadline({ attorney_confirmed: false })] as never }));
    expect(r.officeActionDue?.confirmed).toBe(false);
    expect(W.COL_UNCONFIRMED_SUFFIX).toBe(" · unconfirmed");
    expect(factCells(r, TODAY).oaDue.text).toBe(`Nov 20${W.COL_UNCONFIRMED_SUFFIX}`);
    const confirmed = matterRow(base({ deadlines: [deadline()] as never }));
    expect(factCells(confirmed, TODAY).oaDue.text).toBe("Nov 20");
  });
  it("overdue is flagged for the risk class; today and later are not", () => {
    expect(factCells(matterRow(base({ deadlines: [deadline({ due_date: "2026-10-30" })] as never })), TODAY).oaDue.overdue).toBe(true);
    expect(factCells(matterRow(base({ deadlines: [deadline({ due_date: "2026-11-02" })] as never })), TODAY).oaDue.overdue).toBe(false);
  });
  it("a failed deadlines read leaves the field absent and the matter's cell says Couldn't load, never a dash", () => {
    const r = matterRow(base({ deadlines: [], sources: { activity: "ok", deadlines: "unavailable" } }));
    expect("officeActionDue" in r).toBe(false);
    expect(factCells(r, TODAY).oaDue).toEqual({ text: "Couldn't load", tone: "failed" });
    // the lead's cell is a plain dash even then: the fact does not exist for a lead.
    expect(factCells(leadRow(base({ sources: { activity: "ok", deadlines: "unavailable" } })), TODAY).oaDue.text).toBe("—");
  });
});

describe("outputs unchanged by new fields", () => {
  // The same rows with and without every new optional field must give identical buckets, lanes, strips and deck.
  const NEW_FIELDS = ["serialNumber", "startDate", "practiceArea", "officeActionDue", "fees"] as const;
  const strip = (r: ReviewRow): ReviewRow => {
    const copy = { ...r } as Record<string, unknown>;
    for (const f of NEW_FIELDS) delete copy[f];
    return copy as ReviewRow;
  };
  const members = [{ userId: "u1", name: "Rebecca Ames", role: "owner" }, { userId: "u2", name: "Sam Park", role: "paralegal" }];
  const tasks = [{ id: "t1", title: "Call", due_at: "2026-10-30T00:00:00Z", assignee_id: "u2", matter_id: "m1", lead_id: null }];
  const withFields = buildReviewRows(base({ tasks, deadlines: [deadline()] as never })).map((r) => ({ ...r, fees: { legal: { text: "$1,250.00", from: "proposal" as const }, legalDue: null, gov: null, govDue: null } }));
  const without = withFields.map(strip);

  it("reviewBuckets, laneOf, placeOnBoard, boardLanes, the strips and buildDeck are deep-equal", () => {
    const wb = reviewBuckets(withFields, TODAY);
    const ob = reviewBuckets(without, TODAY);
    expect(strip2(wb)).toEqual(strip2(ob));
    expect(withFields.map(laneOf)).toEqual(without.map(laneOf));
    expect(withFields.map((r) => placeOnBoard(r, "overdue"))).toEqual(without.map((r) => placeOnBoard(r, "overdue")));
    expect(strip2(boardLanes(wb, members))).toEqual(strip2(boardLanes(ob, members)));
    expect(waitingOnPerson(withFields, "u2").map((r) => r.key)).toEqual(waitingOnPerson(without, "u2").map((r) => r.key));
    expect(strip2(proposalsOut(withFields, TODAY))).toEqual(strip2(proposalsOut(without, TODAY)));
    expect(strip2(deadlinesOut(withFields, TODAY))).toEqual(strip2(deadlinesOut(without, TODAY)));
    expect(strip2(buildDeck(wb, members, "u2"))).toEqual(strip2(buildDeck(ob, members, "u2")));
  });
  it("the new fields are present on one side and absent on the other (the comparison is real)", () => {
    expect(withFields.some((r) => r.fees && r.startDate)).toBe(true);
    expect(without.every((r) => !("fees" in r) && !("startDate" in r))).toBe(true);
  });
});

/** Deep copy with the new fields removed anywhere, so a bucket holding rows compares on what it decided. */
function strip2<T>(value: T): unknown {
  const drop = new Set(["serialNumber", "startDate", "practiceArea", "officeActionDue", "fees"]);
  return JSON.parse(JSON.stringify(value, (k, v) => (drop.has(k) ? undefined : v)));
}
