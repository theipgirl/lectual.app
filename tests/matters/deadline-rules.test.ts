import { describe, it, expect } from "vitest";
import {
  CALCULATED_DEADLINE_NOTICE,
  DEADLINE_KINDS,
  addDays,
  addMonths,
  daysUntil,
  deadlineKindLabel,
  deadlineRule,
  isDeadlineKind,
  isDeadlineSource,
  isDeadlineStatus,
  suggestDeadline,
} from "@/lib/matters/deadline-rules";

// Pure module — no DB, so this suite always runs.

describe("addMonths", () => {
  it("adds calendar months", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonths("2026-08-09", 6)).toBe("2027-02-09");
  });

  it("clamps to the last day of the target month when the day does not exist", () => {
    // 31 Aug + 6 months has no 31 Feb.
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    // Leap year.
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("crosses year boundaries", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-06-01", 72)).toBe("2032-06-01");
    expect(addMonths("2026-06-01", 120)).toBe("2036-06-01");
  });

  it("returns null for a value that is not a real civil date", () => {
    expect(addMonths("2026-02-30", 1)).toBeNull();
    expect(addMonths("not-a-date", 1)).toBeNull();
    expect(addMonths("2026-1-5", 1)).toBeNull();
  });
});

describe("addDays", () => {
  it("adds exact days across a month boundary", () => {
    expect(addDays("2026-08-20", 30)).toBe("2026-09-19");
  });

  it("adds exact days across a leap day", () => {
    expect(addDays("2028-02-20", 30)).toBe("2028-03-21");
  });

  it("returns null for an unreal date", () => {
    expect(addDays("2026-13-01", 30)).toBeNull();
  });
});

describe("daysUntil", () => {
  it("counts whole days regardless of the hour the page rendered", () => {
    const morning = new Date("2026-08-09T00:30:00Z");
    const night = new Date("2026-08-09T23:30:00Z");
    expect(daysUntil("2026-08-19", morning)).toBe(10);
    expect(daysUntil("2026-08-19", night)).toBe(10);
  });

  it("is 0 on the due date and negative once past due", () => {
    const today = new Date("2026-08-09T12:00:00Z");
    expect(daysUntil("2026-08-09", today)).toBe(0);
    expect(daysUntil("2026-08-04", today)).toBe(-5);
  });
});

describe("the SOP deadline rules", () => {
  it("covers every kind with a label", () => {
    for (const kind of DEADLINE_KINDS) {
      expect(deadlineKindLabel(kind).length).toBeGreaterThan(0);
    }
  });

  it("Office Action response: 3 months, one extension (SOP phase 7)", () => {
    const rule = deadlineRule("office_action_response");
    expect(rule.interval).toEqual({ months: 3 });
    expect(rule.extendable).toBe(true);
    expect(rule.maxExtensions).toBe(1);
    expect(suggestDeadline("office_action_response", "2026-08-09")?.dueDate).toBe("2026-11-09");
  });

  it("Office Action response in a §66(a) matter: 6 months, non-extendable", () => {
    const rule = deadlineRule("office_action_response", "66a");
    expect(rule.interval).toEqual({ months: 6 });
    expect(rule.extendable).toBe(false);
    expect(rule.maxExtensions).toBeNull();
    const suggestion = suggestDeadline("office_action_response", "2026-08-09", "66a");
    expect(suggestion?.dueDate).toBe("2027-02-09");
    expect(suggestion?.extendable).toBe(false);
  });

  it("leaves the standard Office Action period alone for other filing bases", () => {
    for (const basis of ["1a", "1b", "44d", "44e"] as const) {
      expect(deadlineRule("office_action_response", basis).interval).toEqual({ months: 3 });
    }
  });

  it("Statement of Use: 6 months from the NOA, extendable five times (SOP phase 8)", () => {
    const rule = deadlineRule("statement_of_use");
    expect(rule.interval).toEqual({ months: 6 });
    expect(rule.extendable).toBe(true);
    expect(rule.maxExtensions).toBe(5);
    // 6 months + 5 × 6 months = 36 months from the Notice of Allowance.
    expect(addMonths("2026-08-09", 6 + 5 * 6)).toBe("2029-08-09");
    expect(suggestDeadline("statement_of_use", "2026-08-09")?.dueDate).toBe("2027-02-09");
  });

  it("SOU extension request has no reference interval — the file sets the date", () => {
    expect(deadlineRule("sou_extension_request").interval).toBeNull();
    expect(suggestDeadline("sou_extension_request", "2026-08-09")).toBeNull();
  });

  it("opposition window: 30 days from publication, not extendable (SOP phase 10)", () => {
    const rule = deadlineRule("opposition_window");
    expect(rule.interval).toEqual({ days: 30 });
    expect(rule.extendable).toBe(false);
    expect(suggestDeadline("opposition_window", "2026-08-09")?.dueDate).toBe("2026-09-08");
  });

  it("Section 8: 6th anniversary of registration (SOP phase 11)", () => {
    expect(deadlineRule("section_8_declaration").interval).toEqual({ months: 72 });
    expect(suggestDeadline("section_8_declaration", "2026-08-09")?.dueDate).toBe("2032-08-09");
  });

  it("Section 15: same window as the Section 8, and flagged optional", () => {
    const rule = deadlineRule("section_15_declaration");
    expect(rule.interval).toEqual({ months: 72 });
    expect(rule.optional).toBe(true);
    expect(rule.extendable).toBe(false);
  });

  it("Section 9 renewal: 10th anniversary of registration", () => {
    expect(deadlineRule("section_9_renewal").interval).toEqual({ months: 120 });
    expect(suggestDeadline("section_9_renewal", "2026-08-09")?.dueDate).toBe("2036-08-09");
  });

  it("§44(d) priority window: 6 months from the foreign filing", () => {
    expect(suggestDeadline("priority_filing", "2026-08-09")?.dueDate).toBe("2027-02-09");
  });

  it("'other' has no interval, so nothing is auto-suggested for it", () => {
    expect(suggestDeadline("other", "2026-08-09")).toBeNull();
  });
});

describe("suggestions are labelled, never asserted", () => {
  it("every suggestion carries the plain-language basis that produced it", () => {
    const suggestion = suggestDeadline("statement_of_use", "2026-08-09");
    expect(suggestion?.basis).toMatch(/6 months from the Notice of Allowance/i);
  });

  it("the notice shown alongside a calculated date says an attorney confirms it", () => {
    expect(CALCULATED_DEADLINE_NOTICE).toMatch(/not a legal determination/i);
    expect(CALCULATED_DEADLINE_NOTICE).toMatch(/confirm/i);
  });

  it("refuses to suggest anything from an unreal anchor date", () => {
    expect(suggestDeadline("statement_of_use", "2026-02-31")).toBeNull();
    expect(suggestDeadline("opposition_window", "")).toBeNull();
  });
});

describe("enum guards", () => {
  it("accepts only real kinds/sources/statuses", () => {
    expect(isDeadlineKind("statement_of_use")).toBe(true);
    expect(isDeadlineKind("statement_of_intent")).toBe(false);
    expect(isDeadlineSource("calculated")).toBe(true);
    expect(isDeadlineSource("guessed")).toBe(false);
    expect(isDeadlineStatus("superseded")).toBe(true);
    expect(isDeadlineStatus("missed")).toBe(false);
  });
});
