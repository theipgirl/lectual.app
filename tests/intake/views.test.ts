import { describe, it, expect } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { buildIntakeRows, type IntakeRow } from "@/lib/intake/rows";
import {
  initialsOf,
  memberLabel,
  nextStepFor,
  ownerColumns,
  stageCodeFor,
  stageColumns,
  stageLabelFor,
  topBarCounts,
  topBarLine,
  touchDate,
  touchStampFor,
} from "@/lib/intake/views";

/**
 * Pure coverage for the /intake arrangement layer (blueprint §11). Every case
 * pins `now` explicitly — nothing here may depend on the wall clock, or the
 * suite starts failing on its own a week after it was written.
 *
 * The fixtures are synthetic. The real September export is used to verify
 * PARSING and never to seed a test: no client of RPB Law's appears in this
 * repository.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function stage(overrides: Partial<Stage>): Stage {
  return {
    id: "s1",
    org_id: "org-1",
    name: "Follow-Up",
    order_index: 1,
    category: "open",
    aging_threshold_days: 7,
    created_at: NOW.toISOString(),
    ...overrides,
  } as Stage;
}

const STAGES: Stage[] = [
  stage({ id: "s1", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s2", name: "Contacted", order_index: 2, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s5", name: "Nurture", order_index: 5, category: "nurture", aging_threshold_days: 30 }),
  // The conversion boundary — never an intake column.
  stage({ id: "s8", name: "Signed LOE", order_index: 8, category: "won", aging_threshold_days: null }),
];

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: "l1",
    org_id: "org-1",
    first_name: "Ada",
    last_name: "Nwosu",
    email: "ada@example.com",
    business_name: null,
    phone: null,
    website: null,
    current_stage_id: "s1",
    stage_entered_at: daysBefore(2),
    assigned_to: null,
    last_activity_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    mark_text: null,
    practice_area: "Trademark",
    referral_source: "Inbound",
    referral_detail: null,
    nurture_campaign: null,
    nurture_last_sent_at: null,
    sheet_key: null,
    temperature: null,
    temperature_set_at: null,
    temperature_set_by: null,
    ai_red_flags: [],
    ai_summary: null,
    ai_enriched_at: null,
    founder_id: null,
    lawmatics_id: null,
    lawmatics_synced_at: null,
    qualification_score: null,
    urgency_band: "normal",
    value_band: "unknown",
    created_at: daysBefore(30),
    updated_at: daysBefore(2),
    ...overrides,
  } as unknown as Lead;
}

const MEMBERS: MemberIdentity[] = [
  { userId: "u-rb", email: "rebecca@example.com", displayName: "Rebecca P. Beliard", role: "owner", identified: true },
  { userId: "u-dw", email: "dawn@example.com", displayName: "Dawn Whitaker", role: "intake", identified: true },
];

function rowsFor(leads: Lead[], notes: Record<string, string> = {}): IntakeRow[] {
  return buildIntakeRows({ leads, stages: STAGES, members: MEMBERS, latestNoteByLeadId: notes, now: NOW });
}

describe("stageCodeFor / stageLabelFor", () => {
  it("uses order_index when the stage name carries no number", () => {
    const s = stage({ name: "Consult booked", order_index: 3 });
    expect(stageCodeFor(s)).toBe("3");
    expect(stageLabelFor(s)).toBe("Consult booked");
  });

  it("prefers a number the firm put in the stage name over order_index", () => {
    // A firm that numbers its own stages off the spreadsheet must see its own
    // numbers, not the row order they happen to sit in.
    const s = stage({ name: "4 · Quote sent", order_index: 9 });
    expect(stageCodeFor(s)).toBe("4");
    expect(stageLabelFor(s)).toBe("Quote sent");
  });

  it("strips several separator spellings without eating the label", () => {
    expect(stageLabelFor(stage({ name: "2. Contacted" }))).toBe("Contacted");
    expect(stageLabelFor(stage({ name: "6 - Unresolved" }))).toBe("Unresolved");
    expect(stageLabelFor(stage({ name: "7" }))).toBe("7");
  });

  it("says so rather than guessing when the stage is missing", () => {
    expect(stageCodeFor(null)).toBe("—");
    expect(stageLabelFor(null)).toBe("Unresolved");
  });
});

describe("stageColumns", () => {
  it("draws one column per intake stage in order, won excluded", () => {
    const columns = stageColumns(rowsFor([]), STAGES);
    expect(columns.map((column) => column.stage.id)).toEqual(["s1", "s2", "s5"]);
  });

  it("keeps an empty stage as a real column", () => {
    // A board that only draws occupied stages hides exactly the column a
    // Monday triage is looking for — the one nobody has moved anyone into.
    const columns = stageColumns(rowsFor([lead({ id: "a", current_stage_id: "s1" })]), STAGES);
    expect(columns.map((column) => column.count)).toEqual([1, 0, 0]);
    expect(columns[1].rows).toEqual([]);
  });

  it("puts each row in its own stage's column", () => {
    const columns = stageColumns(
      rowsFor([
        lead({ id: "a", current_stage_id: "s1" }),
        lead({ id: "b", current_stage_id: "s2" }),
        lead({ id: "c", current_stage_id: "s2" }),
      ]),
      STAGES,
    );
    expect(columns[0].rows.map((row) => row.lead.id)).toEqual(["a"]);
    expect(columns[1].rows.map((row) => row.lead.id)).toEqual(["b", "c"]);
  });

  it("drops a row whose stage is not an intake stage rather than inventing a column", () => {
    const columns = stageColumns(rowsFor([lead({ id: "won", current_stage_id: "s8" })]), STAGES);
    expect(columns.flatMap((column) => column.rows)).toHaveLength(0);
  });
});

describe("initialsOf / memberLabel", () => {
  it("takes the first and last word of a display name", () => {
    expect(initialsOf(MEMBERS[0])).toBe("RB");
    expect(initialsOf({ displayName: "Dawn Otiti", email: null })).toBe("DO");
  });

  it("falls back through a one-word name and then the email", () => {
    expect(initialsOf({ displayName: "Taylor", email: null })).toBe("TA");
    expect(initialsOf({ displayName: null, email: "marcus@example.com" })).toBe("MA");
    expect(initialsOf(null)).toBe("?");
  });

  it("labels a member by name, then email, then the bare id", () => {
    expect(memberLabel(MEMBERS[1])).toBe("Dawn Whitaker");
    expect(memberLabel({ ...MEMBERS[1], displayName: null })).toBe("dawn@example.com");
    expect(memberLabel({ ...MEMBERS[1], displayName: null, email: null })).toBe("u-dw");
  });
});

describe("ownerColumns", () => {
  const rows = rowsFor([
    lead({ id: "a", assigned_to: null }),
    lead({ id: "b", assigned_to: "u-rb", last_inbound_at: daysBefore(1), last_outbound_at: daysBefore(4) }),
    lead({ id: "c", assigned_to: "u-rb", last_outbound_at: daysBefore(1) }),
    lead({ id: "d", assigned_to: "u-dw" }),
  ]);

  it("puts Unassigned first, then every member — even one carrying nothing", () => {
    const columns = ownerColumns(rows, MEMBERS);
    expect(columns.map((column) => column.key)).toEqual([null, "u-rb", "u-dw"]);
    expect(columns[0].label).toBe("Unassigned");
    expect(columns[0].count).toBe(1);
  });

  it("counts how many of a person's leads are waiting on the firm", () => {
    const columns = ownerColumns(rows, MEMBERS);
    const rebecca = columns[1];
    expect(rebecca.count).toBe(2);
    expect(rebecca.waitingOnUs).toBe(1);
    expect(rebecca.load).toBe("2 open · 1 waiting on us");
  });

  it("gives an unresolvable assignee a column of their own, not Unassigned", () => {
    // Their leads falling into Unassigned would read as "free to grab", which
    // is the opposite of true.
    const columns = ownerColumns(rowsFor([lead({ id: "x", assigned_to: "u-ghost" })]), MEMBERS);
    expect(columns.map((column) => column.key)).toEqual([null, "u-rb", "u-dw", "u-ghost"]);
    expect(columns[0].count).toBe(0);
    expect(columns[3].count).toBe(1);
    expect(columns[3].label).toBe("Unknown teammate");
  });

  it("describes an empty column and an all-waiting column in words, not 0s", () => {
    const columns = ownerColumns(rows, MEMBERS);
    expect(columns[0].load).toBe("needs a person");
    expect(columns[2].load).toBe("1 open · none waiting on us");

    const allWaiting = ownerColumns(
      rowsFor([
        lead({ id: "p", assigned_to: "u-dw", last_inbound_at: daysBefore(1) }),
        lead({ id: "q", assigned_to: "u-dw", last_inbound_at: daysBefore(2) }),
      ]),
      MEMBERS,
    );
    expect(allWaiting[2].load).toBe("2 open · all waiting on us");
  });
});

describe("touchDate / touchStampFor", () => {
  it("stamps the day and month, with the arrow the legend explains", () => {
    expect(touchDate(daysBefore(2))).toBe("12 Sep");

    const [waiting] = rowsFor([lead({ id: "a", last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(5) })]);
    expect(touchStampFor(waiting)).toEqual({ text: "12 Sep ←", waitingOnUs: true });

    const [theirs] = rowsFor([lead({ id: "b", last_outbound_at: daysBefore(5) })]);
    expect(touchStampFor(theirs)).toEqual({ text: "9 Sep →", waitingOnUs: false });
  });

  it("shows an em-dash when nothing has ever happened", () => {
    const [never] = rowsFor([lead({ id: "c" })]);
    expect(touchStampFor(never)).toEqual({ text: "—", waitingOnUs: false });
    expect(touchDate(null)).toBeNull();
    expect(touchDate("not a date")).toBeNull();
  });
});

describe("nextStepFor", () => {
  it("uses the latest note when the firm wrote one", () => {
    const [row] = rowsFor([lead({ id: "a", last_outbound_at: daysBefore(1) })], { a: "Sent the intake form" });
    expect(nextStepFor(row, NOW).text).toBe("Sent the intake form");
  });

  it("otherwise states the reply state as a fact, never a suggestion", () => {
    const [waiting] = rowsFor([lead({ id: "a", last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(6) })]);
    expect(nextStepFor(waiting, NOW).text).toBe("Waiting on our reply since 12 Sep");

    const [theirs] = rowsFor([lead({ id: "b", last_outbound_at: daysBefore(5) })]);
    expect(nextStepFor(theirs, NOW).text).toBe("Waiting on them since 9 Sep");
  });

  it("says nothing has happened rather than inventing a next step", () => {
    const [row] = rowsFor([lead({ id: "c" })]);
    expect(nextStepFor(row, NOW)).toEqual({ text: "No activity yet", urgent: false });
  });

  it("goes urgent once a reply has sat unanswered for three days", () => {
    const twoDays = rowsFor([lead({ id: "a", last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(9) })])[0];
    expect(nextStepFor(twoDays, NOW).urgent).toBe(false);

    const threeDays = rowsFor([lead({ id: "b", last_inbound_at: daysBefore(3), last_outbound_at: daysBefore(9) })])[0];
    expect(nextStepFor(threeDays, NOW).urgent).toBe(true);
  });

  it("goes urgent for a stale row even when the note reads fine", () => {
    // s2's aging threshold is 5 days and this row entered 12 days ago.
    const [row] = rowsFor(
      [lead({ id: "a", current_stage_id: "s2", stage_entered_at: daysBefore(12), last_outbound_at: daysBefore(12) })],
      { a: "Quote sent, waiting" },
    );
    expect(row.stale).toBe(true);
    expect(nextStepFor(row, NOW)).toEqual({ text: "Quote sent, waiting", urgent: true });
  });
});

describe("topBarCounts / topBarLine", () => {
  it("counts the list it is sitting above", () => {
    const rows = rowsFor([
      lead({ id: "a", assigned_to: null, last_inbound_at: daysBefore(1), last_outbound_at: daysBefore(3) }),
      lead({ id: "b", assigned_to: "u-rb", last_outbound_at: daysBefore(3) }),
      lead({ id: "c", assigned_to: null }),
    ]);
    const counts = topBarCounts(rows);
    expect(counts).toEqual({ inIntake: 3, needFirstReply: 1, unassigned: 2 });
    expect(topBarLine(counts)).toBe("3 in intake · 1 need a first reply · 2 unassigned");
  });

  it("is all zeros for an empty list rather than undefined", () => {
    expect(topBarLine(topBarCounts([]))).toBe("0 in intake · 0 need a first reply · 0 unassigned");
  });
});
