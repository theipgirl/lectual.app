import { describe, it, expect } from "vitest";
import {
  AWAITING_REGISTRATION_STAGE_CODE,
  FIRM_EA_REVIEW_ESTIMATE_MONTHS,
  MONTHLY_SEQUENCE_MAX_MONTHS,
  monthsElapsed,
  computeFollowUpStatus,
  followUpNeedsAttention,
  monthlyUpdateHeadline,
  parseMonthlyUpdateMonth,
  buildMonthlyStatusUpdateDraft,
  buildFilingFollowUpRows,
  type FilingFollowUpMatterInput,
} from "@/lib/matters/filing-followup";

describe("monthsElapsed", () => {
  it("is 0 for a filing date within the current month", () => {
    expect(monthsElapsed("2026-08-05", new Date("2026-08-21T00:00:00.000Z"))).toBe(0);
  });

  it("counts whole months only, not rounding up on a partial month", () => {
    // Filed Jan 20, "now" is Feb 19 — not yet a full month.
    expect(monthsElapsed("2026-01-20", new Date("2026-02-19T00:00:00.000Z"))).toBe(0);
    // One day later it ticks over to 1.
    expect(monthsElapsed("2026-01-20", new Date("2026-02-20T00:00:00.000Z"))).toBe(1);
  });

  it("handles a multi-month gap", () => {
    expect(monthsElapsed("2026-01-15", new Date("2026-08-21T00:00:00.000Z"))).toBe(7);
  });

  it("returns 0 for an unparseable date rather than throwing", () => {
    expect(monthsElapsed("not-a-date", new Date())).toBe(0);
  });
});

describe("computeFollowUpStatus", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");

  it("flags no_filing_date when the matter has none on file", () => {
    expect(computeFollowUpStatus({ filingDate: null, monthsAlreadyQueued: [] }, now)).toEqual({
      kind: "no_filing_date",
    });
  });

  it("is not_due inside the first month", () => {
    const status = computeFollowUpStatus(
      { filingDate: "2026-08-05", monthsAlreadyQueued: [] },
      now,
    );
    expect(status).toEqual({ kind: "not_due", monthsElapsed: 0 });
  });

  it("is due for month 1 once a month has elapsed with nothing queued yet", () => {
    const status = computeFollowUpStatus(
      { filingDate: "2026-07-15", monthsAlreadyQueued: [] },
      now,
    );
    expect(status).toEqual({
      kind: "due",
      monthsElapsed: 1,
      monthNumber: 1,
      monthsRemainingEstimate: FIRM_EA_REVIEW_ESTIMATE_MONTHS - 1,
    });
  });

  it("is already_queued when the current target month is already queued or approved", () => {
    const status = computeFollowUpStatus(
      { filingDate: "2026-07-15", monthsAlreadyQueued: [1] },
      now,
    );
    expect(status).toEqual({ kind: "already_queued", monthNumber: 1 });
  });

  it("advances to the next SEQUENTIAL month, never skipping ahead to match monthsElapsed", () => {
    // Filed 3 months ago but only month 1 was ever queued — offers month 2
    // next, not month 3.
    const status = computeFollowUpStatus(
      { filingDate: "2026-05-15", monthsAlreadyQueued: [1] },
      now,
    );
    expect(status).toMatchObject({ kind: "due", monthNumber: 2 });
  });

  it("is stale past the ~5-month sequence rather than auto-drafting a 6th+ update", () => {
    const status = computeFollowUpStatus(
      { filingDate: "2026-01-01", monthsAlreadyQueued: [] },
      now,
    );
    expect(status.kind).toBe("stale");
  });

  it("is queue_unknown (never 'due') when the queue state couldn't be determined", () => {
    const status = computeFollowUpStatus(
      { filingDate: "2026-07-15", monthsAlreadyQueued: null },
      now,
    );
    expect(status).toEqual({ kind: "queue_unknown" });
  });
});

describe("followUpNeedsAttention", () => {
  it("is true for due, stale, and no_filing_date", () => {
    expect(followUpNeedsAttention({ kind: "due", monthsElapsed: 1, monthNumber: 1, monthsRemainingEstimate: 8 })).toBe(true);
    expect(followUpNeedsAttention({ kind: "stale", monthsElapsed: 7 })).toBe(true);
    expect(followUpNeedsAttention({ kind: "no_filing_date" })).toBe(true);
  });

  it("is false for not_due, already_queued, and queue_unknown", () => {
    expect(followUpNeedsAttention({ kind: "not_due", monthsElapsed: 0 })).toBe(false);
    expect(followUpNeedsAttention({ kind: "already_queued", monthNumber: 2 })).toBe(false);
    expect(followUpNeedsAttention({ kind: "queue_unknown" })).toBe(false);
  });
});

describe("monthlyUpdateHeadline / parseMonthlyUpdateMonth", () => {
  it("round-trips a month number through the headline", () => {
    const headline = monthlyUpdateHeadline("SUNBEAM", 3);
    expect(headline).toBe(`Monthly Status Update — Month 3 of ~${MONTHLY_SEQUENCE_MAX_MONTHS} — SUNBEAM`);
    expect(parseMonthlyUpdateMonth(headline)).toBe(3);
  });

  it("returns null for a headline that isn't one of ours", () => {
    expect(parseMonthlyUpdateMonth("Opinion letter DRAFT — Jane Doe — SUNBEAM")).toBeNull();
  });

  it("recognizes the crew sweep's own headline shape (same pattern, different agent)", () => {
    expect(
      parseMonthlyUpdateMonth(
        "Monthly Status Update — Month 2 of ~5 — HERKIND — VERIFY: confirm this is the next update due before approving",
      ),
    ).toBe(2);
  });
});

describe("buildMonthlyStatusUpdateDraft — deterministic, no AI", () => {
  it("fills the template verbatim with the given facts", () => {
    const draft = buildMonthlyStatusUpdateDraft({
      clientFirstName: "Jane",
      markText: "SUNBEAM",
      monthNumber: 2,
      monthsRemainingEstimate: 7,
    });
    expect(draft.subject).toBe("A quick update on your trademark application");
    expect(draft.draftBody).toContain("Hello Jane,");
    expect(draft.draftBody).toContain("your trademark application for **SUNBEAM**");
    expect(draft.draftBody).toContain("about **2 months** into the process");
    expect(draft.draftBody).toContain("approximately **7 months**");
    expect(draft.draftBody).toContain("⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.");
    expect(draft.headline).toBe("Monthly Status Update — Month 2 of ~5 — SUNBEAM");
  });

  it("singularizes 'month' at exactly 1", () => {
    const draft = buildMonthlyStatusUpdateDraft({
      clientFirstName: "Jane",
      markText: "SUNBEAM",
      monthNumber: 1,
      monthsRemainingEstimate: 1,
    });
    expect(draft.draftBody).toContain("about **1 month** into the process");
    expect(draft.draftBody).toContain("approximately **1 month**.");
  });
});

describe("buildFilingFollowUpRows", () => {
  const now = new Date("2026-08-21T00:00:00.000Z");
  const matters: FilingFollowUpMatterInput[] = [
    {
      id: "m-due",
      matter_number: "TM-2026-0001",
      mark_text: "SUNBEAM",
      title: null,
      filing_date: "2026-07-01",
      stage: { code: AWAITING_REGISTRATION_STAGE_CODE },
    },
    {
      id: "m-other-stage",
      matter_number: "TM-2026-0002",
      mark_text: "MOONBEAM",
      title: null,
      filing_date: "2026-01-01",
      stage: { code: "19A" },
    },
    {
      id: "m-not-due",
      matter_number: "TM-2026-0003",
      mark_text: "STARBEAM",
      title: null,
      filing_date: "2026-08-15",
      stage: { code: AWAITING_REGISTRATION_STAGE_CODE },
    },
  ];

  it("only includes matters actually in the awaiting-registration stage", () => {
    const rows = buildFilingFollowUpRows(matters, new Map(), now);
    expect(rows.map((r) => r.matterId)).toEqual(["m-due", "m-not-due"]);
  });

  it("sorts due first", () => {
    const rows = buildFilingFollowUpRows(matters, new Map(), now);
    expect(rows[0]).toMatchObject({ matterId: "m-due", status: { kind: "due" } });
  });

  it("falls back to queue_unknown for every row when the lookup is null (queue unreachable)", () => {
    const rows = buildFilingFollowUpRows(matters, null, now);
    const dueRow = rows.find((r) => r.matterId === "m-due");
    expect(dueRow?.status.kind).toBe("queue_unknown");
  });
});
