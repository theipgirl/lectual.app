import { describe, it, expect } from "vitest";
import { NEEDS_REVIEW_PAST_DUE_DAYS, deadlineNeedsReview, splitNeedsReview, type DeadlineReviewFields } from "@/lib/matters/deadline-rules";
import { buildCalendarRows, groupCalendarRows } from "@/lib/matters/calendar-rows";
import type { UpcomingDeadline } from "@/lib/matters/deadlines";
import type { Task } from "@/lib/matters/tasks";

const NOW = new Date("2026-10-20T12:00:00Z");
const TODAY = "2026-10-20";
const DAY = 86_400_000;

/** Civil date `offset` days from NOW (UTC calendar day; the fixtures sit at noon, so any local zone agrees). */
function civil(offset: number): string {
  return new Date(NOW.getTime() + offset * DAY).toISOString().slice(0, 10);
}

function deadline(over: Partial<UpcomingDeadline> = {}): UpcomingDeadline {
  return {
    id: "dl-1",
    org_id: "org-1",
    matter_id: "matter-1",
    kind: "office_action_response",
    title: null,
    due_date: civil(5),
    anchor_event: null,
    anchor_date: null,
    source: "manual",
    calculation_basis: null,
    is_extendable: false,
    max_extensions: null,
    extensions_used: 0,
    notes: null,
    status: "open",
    attorney_confirmed: false,
    confirmed_by: null,
    confirmed_at: null,
    satisfied_at: null,
    created_by: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    matter_number: "RPB-0001",
    matter_title: "Trademark — Doe Studio",
    ...over,
  };
}

const phantom = (over: Partial<UpcomingDeadline> = {}) => deadline({ id: "phantom", due_date: civil(-181), ...over });

describe("deadlineNeedsReview (N1)", () => {
  it("the threshold is 180 days", () => {
    expect(NEEDS_REVIEW_PAST_DUE_DAYS).toBe(180);
  });

  it("an open, unconfirmed, manual date 181 days past due needs review", () => {
    expect(deadlineNeedsReview(phantom(), TODAY)).toBe(true);
  });

  it("exactly 180 days past due does not (strictly more than)", () => {
    expect(deadlineNeedsReview(phantom({ due_date: civil(-180) }), TODAY)).toBe(false);
  });

  it("a confirmed date never does", () => {
    expect(deadlineNeedsReview(phantom({ attorney_confirmed: true }), TODAY)).toBe(false);
  });

  it("a calculated date or one from an office notice never does: a blown real date stays loud", () => {
    expect(deadlineNeedsReview(phantom({ source: "calculated" }), TODAY)).toBe(false);
    expect(deadlineNeedsReview(phantom({ source: "official_notice" }), TODAY)).toBe(false);
  });

  it("only open deadlines do", () => {
    for (const status of ["satisfied", "waived", "superseded"] as const) {
      expect(deadlineNeedsReview(phantom({ status }), TODAY)).toBe(false);
    }
  });

  it("a future or recent date does not", () => {
    expect(deadlineNeedsReview(phantom({ due_date: civil(10) }), TODAY)).toBe(false);
    expect(deadlineNeedsReview(phantom({ due_date: civil(-2) }), TODAY)).toBe(false);
    expect(deadlineNeedsReview(phantom({ due_date: TODAY }), TODAY)).toBe(false);
  });

  it("a date that isn't a real civil date is never moved aside", () => {
    expect(deadlineNeedsReview(phantom({ due_date: "not-a-date" }), TODAY)).toBe(false);
    expect(deadlineNeedsReview(phantom(), "garbage")).toBe(false);
  });

  it("the oldest phantoms (782 days) are in", () => {
    expect(deadlineNeedsReview(phantom({ due_date: civil(-782) }), TODAY)).toBe(true);
  });
});

describe("splitNeedsReview (N1)", () => {
  it("puts every row in exactly one list and keeps order", () => {
    const rows: DeadlineReviewFields[] = [
      phantom({ id: "a" }),
      deadline({ id: "b", due_date: civil(3) }),
      phantom({ id: "c", due_date: civil(-300) }),
      deadline({ id: "d", due_date: civil(-5), source: "calculated" }),
    ];
    const { live, needsReview } = splitNeedsReview(rows as UpcomingDeadline[], NOW);
    expect(needsReview.map((d) => (d as UpcomingDeadline).id)).toEqual(["a", "c"]);
    expect(live.map((d) => (d as UpcomingDeadline).id)).toEqual(["b", "d"]);
    expect(live.length + needsReview.length).toBe(rows.length);
  });

  it("an empty list splits into two empty lists", () => {
    expect(splitNeedsReview([], NOW)).toEqual({ live: [], needsReview: [] });
  });
});

describe("buildCalendarRows leaves phantoms out (N2)", () => {
  const realOverdue = deadline({ id: "real", due_date: civil(-30), source: "calculated" });
  const upcoming = deadline({ id: "soon", due_date: civil(7) });

  it("returns exactly the real-overdue and upcoming rows", () => {
    const rows = buildCalendarRows([phantom(), realOverdue, upcoming], [], NOW);
    expect(rows.map((r) => r.key)).toEqual(["d-real", "d-soon"]);
  });

  it("the Overdue group holds only the real one", () => {
    const rows = buildCalendarRows([phantom(), realOverdue, upcoming], [], NOW);
    const overdue = groupCalendarRows(rows, NOW).find((g) => g.key === "overdue");
    expect(overdue?.rows.map((r) => r.key)).toEqual(["d-real"]);
  });

  it("a manual date 100 days past due (under the threshold) is still overdue", () => {
    const rows = buildCalendarRows([deadline({ id: "m", due_date: civil(-100) })], [], NOW);
    expect(rows.map((r) => r.key)).toEqual(["d-m"]);
    expect(rows[0].overdueDays).toBe(100);
  });

  it("tasks are untouched, including one long overdue", () => {
    const task = {
      id: "t1",
      title: "Call the client",
      type: "call",
      due_at: new Date(NOW.getTime() - 400 * DAY).toISOString(),
      matter_id: "matter-1",
      lead_id: null,
    } as unknown as Task;
    const rows = buildCalendarRows([phantom()], [task], NOW);
    expect(rows.map((r) => r.key)).toEqual(["t-t1"]);
  });
});
