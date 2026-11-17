import { describe, it, expect } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { DEFAULT_SORT, buildIntakeRows, sortRows, type IntakeRow } from "@/lib/intake/rows";
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
  sheetDay,
  shownTouch,
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
  it("says whose turn it is in words: Our turn / Waiting on them, with the day and month", () => {
    expect(touchDate(daysBefore(2))).toBe("12 Sep");

    const [waiting] = rowsFor([lead({ id: "a", last_inbound_at: daysBefore(2), last_outbound_at: daysBefore(5) })]);
    expect(touchStampFor(waiting, { now: NOW })).toMatchObject({ text: "Our turn · Sep\u00a012", waitingOnUs: true, state: "our-turn" });

    const [theirs] = rowsFor([lead({ id: "b", last_outbound_at: daysBefore(5) })]);
    expect(touchStampFor(theirs, { now: NOW })).toMatchObject({ text: "Waiting on them · Sep\u00a09", waitingOnUs: false, state: "waiting" });
  });

  it("dates the turn by the inbound / outbound mail, not by a newer note or stage move", () => {
    // A note logged yesterday bumps last_activity_at, but they last wrote 5 days ago: still "Our turn · 9 Sep", sorted by the newest touch.
    const [ours] = rowsFor([lead({ id: "e", last_inbound_at: daysBefore(5), last_outbound_at: daysBefore(8), last_activity_at: daysBefore(1) })]);
    expect(ours.lastTouchAt).toBe(daysBefore(1));
    expect(touchStampFor(ours, { now: NOW })).toMatchObject({ text: "Our turn · Sep\u00a09", state: "our-turn" });
    const [theirs] = rowsFor([lead({ id: "f", last_inbound_at: daysBefore(9), last_outbound_at: daysBefore(4), last_activity_at: daysBefore(1) })]);
    expect(touchStampFor(theirs, { now: NOW })).toMatchObject({ text: "Waiting on them · Sep\u00a010", state: "waiting" });
  });

  it("a future inbound or outbound date is treated as missing, never shown", () => {
    const [future] = rowsFor([lead({ id: "f", last_inbound_at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(), last_activity_at: daysBefore(2) })]);
    expect(touchStampFor(future, { now: NOW }).text).toBe("Last activity · Sep\u00a012");
    expect(touchStampFor(future, { now: NOW }).state).toBe("activity-only");
    expect(sheetDay(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBeNull();
    expect(sheetDay("not a date", NOW)).toBeNull();
    expect(sheetDay(null, NOW)).toBeNull();
  });

  it("only a date and no email or call: says so, and does not guess a side", () => {
    const [only] = rowsFor([lead({ id: "d", last_activity_at: daysBefore(3) })]);
    expect(only.reply).toBe("unknown");
    expect(touchStampFor(only, { now: NOW })).toMatchObject({ text: "Last activity · Sep\u00a011", waitingOnUs: false, state: "activity-only" });
  });

  it("uses the Sheet's date words in the firm's zone, and adds the year only for another year", () => {
    // 02:00Z on 13 Sep is 22:00 on the 12th in New York: the firm's calendar day, as on the weekly review Sheet.
    const [ny] = rowsFor([lead({ id: "g", last_inbound_at: "2026-09-13T02:00:00.000Z", last_activity_at: "2026-09-13T02:00:00.000Z" })]);
    expect(touchStampFor(ny, { now: NOW, timeZone: "America/New_York" }).text).toBe("Our turn · Sep\u00a012");
    expect(touchStampFor(ny, { now: NOW }).text).toBe("Our turn · Sep\u00a013");
    const [old] = rowsFor([lead({ id: "h", last_outbound_at: "2025-12-30T15:00:00.000Z" })]);
    expect(touchStampFor(old, { now: NOW }).text).toBe("Waiting on them · Dec\u00a030, 2025");
  });

  it("says 'No contact yet' when nothing has ever happened", () => {
    const [never] = rowsFor([lead({ id: "c" })]);
    expect(touchStampFor(never, { now: NOW })).toMatchObject({ text: "No contact yet", waitingOnUs: false, state: "none" });
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
    expect(nextStepFor(waiting, NOW).text).toBe("Waiting on our reply since Sep\u00a012");

    const [theirs] = rowsFor([lead({ id: "b", last_outbound_at: daysBefore(5) })]);
    expect(nextStepFor(theirs, NOW).text).toBe("Waiting on them since Sep\u00a09");
  });

  it("says nothing has happened rather than inventing a next step", () => {
    const [row] = rowsFor([lead({ id: "c" })]);
    expect(nextStepFor(row, NOW)).toEqual({ text: "No activity yet", urgent: false, muted: true });
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
    expect(nextStepFor(row, NOW)).toEqual({ text: "Quote sent, waiting", urgent: true, muted: false });
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

describe("the boards keep the sorted order", () => {
  // Three leads in the same stage and owned by the same person: touched yesterday,
  // touched today, never touched. Listed out of order on purpose.
  const sorted = sortRows(
    rowsFor([
      lead({ id: "yesterday", stage_entered_at: daysBefore(2), assigned_to: "u-rb", last_activity_at: daysBefore(1) }),
      lead({ id: "never", assigned_to: "u-rb" }),
      lead({ id: "today", assigned_to: "u-rb", last_activity_at: daysBefore(0) }),
    ]),
    DEFAULT_SORT.key,
    DEFAULT_SORT.dir,
  );
  const ids = (rows: IntakeRow[]) => rows.map((row) => row.lead.id);

  it("by stage: today, yesterday, never", () => {
    const column = stageColumns(sorted, STAGES).find((c) => c.stage.id === "s1")!;
    expect(ids(column.rows)).toEqual(["today", "yesterday", "never"]);
  });

  it("by owner: today, yesterday, never", () => {
    const column = ownerColumns(sorted, MEMBERS).find((c) => c.key === "u-rb")!;
    expect(ids(column.rows)).toEqual(["today", "yesterday", "never"]);
  });
});

describe("the whose-turn column sorts by the date it shows (Item L2)", () => {
  const ids = (rows: { lead: { id: string } }[]) => rows.map((r) => r.lead.id);
  const sorted = (list: Lead[], dir: "asc" | "desc") => ids(sortRows(rowsFor(list), "lastTouch", dir, { now: NOW }));

  it("orders by the inbound date for Our turn, not by a newer note or stage move", () => {
    // A: they last wrote 8 days ago, but a note yesterday made its newest touch 1 day. B: they wrote 4 days ago.
    const a = lead({ id: "A", last_inbound_at: daysBefore(8), last_outbound_at: daysBefore(12), last_activity_at: daysBefore(1) });
    const b = lead({ id: "B", last_inbound_at: daysBefore(4), last_outbound_at: daysBefore(9), last_activity_at: daysBefore(4) });
    // The old lastTouchAt sort put A first (1 day); the shown dates put B first (Sep 10 over Sep 6).
    expect(ids(sortRows(rowsFor([a, b]), "lastTouch", "desc"))).toEqual(["B", "A"]);
    expect(sorted([a, b], "desc")).toEqual(["B", "A"]);
    expect(sorted([a, b], "asc")).toEqual(["A", "B"]);
  });

  it("orders Waiting on them by the outbound date", () => {
    const c = lead({ id: "C", last_inbound_at: daysBefore(9), last_outbound_at: daysBefore(2), last_activity_at: daysBefore(2) });
    const d = lead({ id: "D", last_inbound_at: daysBefore(11), last_outbound_at: daysBefore(6), last_activity_at: daysBefore(1) });
    expect(sorted([d, c], "desc")).toEqual(["C", "D"]);
  });

  it("puts 'No contact yet' last, ascending and descending", () => {
    const old = lead({ id: "old", last_inbound_at: daysBefore(30), last_activity_at: daysBefore(30) });
    const fresh = lead({ id: "fresh", last_inbound_at: daysBefore(1), last_activity_at: daysBefore(1) });
    const none = lead({ id: "none" });
    expect(sorted([none, old, fresh], "desc")).toEqual(["fresh", "old", "none"]);
    expect(sorted([none, old, fresh], "asc")).toEqual(["old", "fresh", "none"]);
  });

  it("a future date counts as missing, exactly as the cell does: it neither shows nor decides the order", () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const f = lead({ id: "F", last_inbound_at: future, last_activity_at: daysBefore(2) });
    const g = lead({ id: "G", last_inbound_at: daysBefore(5), last_activity_at: daysBefore(5) });
    const [fRow] = rowsFor([f]);
    expect(shownTouch(fRow, NOW)).toEqual({ state: "activity-only", iso: daysBefore(2) });
    expect(sorted([g, f], "desc")).toEqual(["F", "G"]);
    // Only a future date and nothing else: "No contact yet", and last.
    const onlyFuture = lead({ id: "H", last_inbound_at: future });
    expect(touchStampFor(rowsFor([onlyFuture])[0], { now: NOW }).state).toBe("none");
    expect(sorted([onlyFuture, g], "desc")).toEqual(["G", "H"]);
    expect(sorted([onlyFuture, g], "asc")).toEqual(["G", "H"]);
  });
});
