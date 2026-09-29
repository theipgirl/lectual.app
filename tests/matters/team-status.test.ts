import { describe, it, expect } from "vitest";
import {
  buildTeamStatusRows,
  buildLeadDeltaRows,
  summarizeMatterActivity,
  weekStartOf,
  isoDate,
  previousWeekStart,
  leadLabel,
  type TeamStatusMatterInput,
  type TeamStatusActivityInput,
  type OwnerDirectoryEntry,
  type TeamStatusLeadInput,
} from "@/lib/matters/team-status";

const NOW = new Date("2026-08-19T12:00:00Z"); // a Wednesday
const DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}

function matter(overrides: Partial<TeamStatusMatterInput> = {}): TeamStatusMatterInput {
  return {
    id: "m-1",
    matter_number: "RPB-0001",
    title: "Trademark — Doe Studio",
    mark_text: "DOE STUDIO",
    status: "open",
    assigned_to: null,
    stage_entered_at: daysAgo(3),
    stage: { code: "07", label: "Search in progress", is_open: true, waiting_on: "firm" },
    ...overrides,
  };
}

function activity(overrides: Partial<TeamStatusActivityInput> = {}): TeamStatusActivityInput {
  return {
    id: "a-1",
    matter_id: "m-1",
    lead_id: null,
    type: "note",
    payload: {},
    created_at: daysAgo(1),
    ...overrides,
  };
}

const DIRECTORY: OwnerDirectoryEntry[] = [
  { userId: "u-taylor", displayName: "Taylor McGhee", email: "taylor@rpblawfirm.com" },
];

describe("buildTeamStatusRows", () => {
  it("puts a matter with activity in `moved` and a quiet open matter in `quiet`", () => {
    const matters = [matter({ id: "moved" }), matter({ id: "quiet" })];
    const acts = [activity({ id: "a1", matter_id: "moved" })];
    const board = buildTeamStatusRows(matters, acts, [], NOW);
    expect(board.moved.map((r) => r.matterId)).toEqual(["moved"]);
    expect(board.quiet.map((r) => r.matterId)).toEqual(["quiet"]);
  });

  it("never puts a closed matter with no activity into `quiet` — nothing to nudge", () => {
    const matters = [matter({ id: "closed", status: "closed" })];
    const board = buildTeamStatusRows(matters, [], [], NOW);
    expect(board.moved).toEqual([]);
    expect(board.quiet).toEqual([]);
  });

  it("DOES surface a closed matter in `moved` when it closed out this week — good news belongs in the review", () => {
    const matters = [matter({ id: "just-registered", status: "closed" })];
    const acts = [
      activity({ id: "a1", matter_id: "just-registered", type: "stage_changed", payload: { to_code: "24", to_label: "Trademark Registered" } }),
    ];
    const board = buildTeamStatusRows(matters, acts, [], NOW);
    expect(board.moved.map((r) => r.matterId)).toEqual(["just-registered"]);
  });

  it("resolves assigned_to into an owner chip via the directory", () => {
    const matters = [matter({ id: "m-owned", assigned_to: "u-taylor" })];
    const board = buildTeamStatusRows(matters, [], DIRECTORY, NOW);
    expect(board.quiet[0].owner).toMatchObject({ userId: "u-taylor", code: "TAM" });
  });

  it("degrades to an id-only chip when assigned_to points at nobody in the directory", () => {
    const matters = [matter({ id: "m-orphan", assigned_to: "u-ghost" })];
    const board = buildTeamStatusRows(matters, [], [], NOW);
    expect(board.quiet[0].owner).toMatchObject({ userId: "u-ghost" });
  });

  it("sorts `moved` newest-activity-first", () => {
    const matters = [matter({ id: "old" }), matter({ id: "new" })];
    const acts = [
      activity({ id: "a-old", matter_id: "old", created_at: daysAgo(5) }),
      activity({ id: "a-new", matter_id: "new", created_at: daysAgo(1) }),
    ];
    const board = buildTeamStatusRows(matters, acts, [], NOW);
    expect(board.moved.map((r) => r.matterId)).toEqual(["new", "old"]);
  });

  it("sorts `quiet` stale-first, then by days-in-stage descending", () => {
    const matters = [
      matter({ id: "fresh", stage_entered_at: daysAgo(2) }), // firm threshold 30d — not stale
      matter({ id: "very-stale", stage_entered_at: daysAgo(90) }), // stale
      matter({ id: "barely-stale", stage_entered_at: daysAgo(31) }), // stale
    ];
    const board = buildTeamStatusRows(matters, [], [], NOW);
    expect(board.quiet.map((r) => r.matterId)).toEqual(["very-stale", "barely-stale", "fresh"]);
  });

  it("carries multiple deltas newest-first per matter", () => {
    const matters = [matter({ id: "m-multi" })];
    const acts = [
      activity({ id: "a1", matter_id: "m-multi", type: "note", created_at: daysAgo(3) }),
      activity({ id: "a2", matter_id: "m-multi", type: "stage_changed", created_at: daysAgo(1), payload: { to_code: "09" } }),
    ];
    const board = buildTeamStatusRows(matters, acts, [], NOW);
    expect(board.moved[0].deltas.map((d) => d.id)).toEqual(["a2", "a1"]);
  });

  it("ignores activity rows attached only to a lead when building the matter board", () => {
    const matters = [matter({ id: "m-1" })];
    const acts = [activity({ id: "a1", matter_id: null, lead_id: "lead-1" })];
    const board = buildTeamStatusRows(matters, acts, [], NOW);
    expect(board.moved).toEqual([]);
    expect(board.quiet.map((r) => r.matterId)).toEqual(["m-1"]);
  });
});

describe("summarizeMatterActivity", () => {
  it("renders a stage_changed delta with both codes", () => {
    const summary = summarizeMatterActivity(
      activity({ type: "stage_changed", payload: { from_code: "07", to_code: "09", to_label: "Specimens requested" } }),
    );
    expect(summary).toBe("Stage: 07 → 09 (Specimens requested)");
  });

  it("dispatches matter_updated on payload.change", () => {
    expect(summarizeMatterActivity(activity({ type: "matter_updated", payload: { change: "owner_assigned" } }))).toBe(
      "Owner reassigned",
    );
    expect(
      summarizeMatterActivity(activity({ type: "matter_updated", payload: { change: "deadline_docketed", due_date: "2026-09-01" } })),
    ).toBe("Deadline docketed — due 2026-09-01");
  });

  it("never renders a blank line for an activity type it hasn't been taught", () => {
    const summary = summarizeMatterActivity(activity({ type: "email_sent", payload: {} }));
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toBe("Email sent");
  });
});

describe("weekStartOf / previousWeekStart", () => {
  it("resolves to the Monday on/before the given date", () => {
    // 2026-08-19 is a Wednesday; the Monday before is 2026-08-17.
    expect(isoDate(weekStartOf(NOW))).toBe("2026-08-17");
  });

  it("is idempotent on a Monday itself", () => {
    const monday = new Date("2026-08-17T09:00:00Z");
    expect(isoDate(weekStartOf(monday))).toBe("2026-08-17");
  });

  it("goes back exactly 7 days for the previous week", () => {
    const ws = weekStartOf(NOW);
    expect(isoDate(previousWeekStart(ws))).toBe("2026-08-10");
  });
});

describe("buildLeadDeltaRows", () => {
  const lead: TeamStatusLeadInput = {
    id: "l-1",
    first_name: "Jamie",
    last_name: "Doe",
    business_name: null,
    assigned_to: "u-taylor",
  };

  it("only includes leads with activity in the window handed to it", () => {
    const rows = buildLeadDeltaRows([lead, { ...lead, id: "l-quiet" }], [activity({ id: "a1", matter_id: null, lead_id: "l-1" })], []);
    expect(rows.map((r) => r.leadId)).toEqual(["l-1"]);
  });

  it("resolves the lead's owner chip the same way matters do", () => {
    const rows = buildLeadDeltaRows([lead], [activity({ id: "a1", matter_id: null, lead_id: "l-1" })], DIRECTORY);
    expect(rows[0].owner).toMatchObject({ code: "TAM" });
  });

  it("prefers business_name, falling back to first+last", () => {
    expect(leadLabel(lead)).toBe("Jamie Doe");
    expect(leadLabel({ ...lead, business_name: "Doe Studio LLC" })).toBe("Doe Studio LLC");
  });
});
