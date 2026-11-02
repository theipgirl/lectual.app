import { describe, expect, it } from "vitest";
import { addDays, bucketOf, daysBetween, reviewBuckets, reviewSubline } from "@/lib/review/buckets";
import { row, TODAY } from "./fixtures";

const step = (dueDate: string | null, assigneeId: string | null = null) => ({ id: "t", title: "x", dueDate, assigneeId });

describe("bucketOf", () => {
  it("overdue when the next step is before today", () => {
    expect(bucketOf(row({ nextStep: step("2026-11-01") }), TODAY)).toBe("overdue");
  });
  it("due today and +6 days are this week; +7 is not", () => {
    expect(bucketOf(row({ nextStep: step(TODAY) }), TODAY)).toBe("week");
    expect(bucketOf(row({ nextStep: step("2026-11-08") }), TODAY)).toBe("week");
    expect(bucketOf(row({ nextStep: step("2026-11-09") }), TODAY)).toBe("track");
  });
  it("no task needs a next step", () => {
    expect(bucketOf(row({ nextStep: null }), TODAY)).toBe("needs");
  });
  it("a task with no due date IS a next step but buckets as needs", () => {
    expect(bucketOf(row({ nextStep: step(null) }), TODAY)).toBe("needs");
  });
  it("quiet: dated step later than this week and contact 14+ days ago or none", () => {
    expect(bucketOf(row({ lastContact: { date: "2026-10-19", type: "email_sent" } }), TODAY)).toBe("quiet");
    expect(bucketOf(row({ lastContact: { date: "2026-10-20", type: "email_sent" } }), TODAY)).toBe("track");
    expect(bucketOf(row({ lastContact: null }), TODAY)).toBe("quiet");
  });
  it("unknown last contact is never quiet", () => {
    expect(bucketOf(row({ contactKnown: false, lastContact: null }), TODAY)).toBe("track");
  });
  it("waiting on the USPTO skips needs and quiet", () => {
    expect(bucketOf(row({ waiting: "uspto", nextStep: null, lastContact: null }), TODAY)).toBe("uspto");
    expect(bucketOf(row({ waiting: "uspto", lastContact: null }), TODAY)).toBe("uspto");
    expect(bucketOf(row({ waiting: "uspto", nextStep: step(null) }), TODAY)).toBe("uspto");
  });
  it("overdue and this week win over USPTO", () => {
    expect(bucketOf(row({ waiting: "uspto", nextStep: step("2026-10-01") }), TODAY)).toBe("overdue");
    expect(bucketOf(row({ waiting: "uspto", nextStep: step(TODAY) }), TODAY)).toBe("week");
  });
});

describe("reviewBuckets", () => {
  const rows = [
    row({ key: "a", client: "A", nextStep: step("2026-10-25") }),
    row({ key: "b", client: "B", nextStep: step("2026-10-20") }),
    row({ key: "c", client: "C", nextStep: null }),
    row({ key: "d", client: "D", waiting: "uspto", nextStep: null }),
    row({ key: "e", client: "E" }),
  ];
  it("puts every row in exactly one section", () => {
    const b = reviewBuckets(rows, TODAY);
    const all = Object.values(b.sections).flat().map((r) => r.key).sort();
    expect(all).toEqual(["a", "b", "c", "d", "e"]);
    expect(Object.values(b.counts).reduce((x, y) => x + y, 0)).toBe(5);
    expect(b.total).toBe(5);
  });
  it("sorts overdue by oldest due first", () => {
    expect(reviewBuckets(rows, TODAY).sections.overdue.map((r) => r.key)).toEqual(["b", "a"]);
  });
  it("sub-line counts", () => {
    expect(reviewSubline(reviewBuckets(rows, TODAY))).toBe("5 open · 2 overdue · 1 needs a next step");
    expect(reviewSubline(reviewBuckets([], TODAY))).toBe("Nothing to review.");
    expect(reviewSubline(reviewBuckets([row({})], TODAY))).toBe("1 open · Nothing needs attention");
  });
});

describe("date helpers", () => {
  it("adds and diffs civil days across a month end", () => {
    expect(addDays("2026-10-30", 6)).toBe("2026-11-05");
    expect(daysBetween("2026-10-19", "2026-11-02")).toBe(14);
  });
});
