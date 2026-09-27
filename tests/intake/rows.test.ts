import { describe, it, expect } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import {
  DEFAULT_SORT,
  DEFAULT_VIEW_STATE,
  EMPTY_INTAKE_FILTERS,
  UNASSIGNED_OWNER,
  agingThresholdOf,
  applyFilters,
  buildIntakeRows,
  computeIntakeKpis,
  filtersToQueryString,
  intakeHref,
  intakeQueryString,
  parseIntakeFilters,
  parseIntakeViewState,
  searchParamsToRecord,
  sortRows,
  type IntakeRow,
} from "@/lib/intake/rows";

/**
 * Pure coverage for the /dashboard/intake view model (blueprint §7). Every
 * case pins `now` explicitly — nothing here may depend on the wall clock, or
 * the suite starts failing on its own at 7 days past whenever it was written.
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

// A small, realistic intake pipeline: first stage, a later stage, a nurture
// stage, and the won stage that marks the conversion boundary (§4.1).
const STAGES: Stage[] = [
  stage({ id: "s1", name: "Follow-Up", order_index: 1, category: "open", aging_threshold_days: 7 }),
  stage({ id: "s2", name: "Consultation Scheduled", order_index: 2, category: "open", aging_threshold_days: 5 }),
  stage({ id: "s3", name: "Undecided / Questions", order_index: 3, category: "nurture", aging_threshold_days: 30 }),
  stage({ id: "s8", name: "Signed LOE / Deposit Received", order_index: 8, category: "won", aging_threshold_days: null }),
];

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: "lead-1",
    org_id: "org-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    phone: null,
    business_name: null,
    website: null,
    founder_id: null,
    current_stage_id: "s1",
    stage_entered_at: daysBefore(2),
    last_activity_at: null,
    assigned_to: null,
    qualification_score: null,
    urgency_band: "none",
    value_band: "LOW",
    ai_summary: null,
    ai_red_flags: [],
    ai_enriched_at: null,
    lawmatics_id: null,
    lawmatics_synced_at: null,
    created_at: daysBefore(30),
    updated_at: daysBefore(2),
    referral_source: null,
    referral_detail: null,
    practice_area: null,
    temperature: null,
    temperature_set_at: null,
    temperature_set_by: null,
    nurture_campaign: null,
    nurture_last_sent_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    mark_text: null,
    sheet_key: null,
    ...overrides,
  } as Lead;
}

function member(overrides: Partial<MemberIdentity>): MemberIdentity {
  return {
    userId: "user-1",
    email: "taylor@example.com",
    displayName: "Taylor McGhee",
    role: "admin",
    identified: true,
    ...overrides,
  };
}

const MEMBERS: MemberIdentity[] = [
  member({ userId: "user-1", displayName: "Taylor McGhee", email: "taylor@example.com" }),
  member({ userId: "user-2", displayName: "Rebecca Beliard", email: "rebecca@example.com" }),
];

function rowsFor(leads: Lead[], latestNoteByLeadId: Record<string, string> = {}): IntakeRow[] {
  return buildIntakeRows({ leads, stages: STAGES, members: MEMBERS, latestNoteByLeadId, now: NOW });
}

// ── parseIntakeFilters ──────────────────────────────────────────────────────
describe("parseIntakeFilters", () => {
  it("returns the empty filter set for no params", () => {
    expect(parseIntakeFilters({})).toEqual(EMPTY_INTAKE_FILTERS);
  });

  it("reads a repeated source param and a comma list identically", () => {
    expect(parseIntakeFilters({ source: ["UGW", "Event"] }).source).toEqual(["UGW", "Event"]);
    expect(parseIntakeFilters({ source: "UGW,Event" }).source).toEqual(["UGW", "Event"]);
  });

  it("drops unrecognised values rather than filtering everything out", () => {
    // An unknown value must NOT become a filter nobody matches — that renders
    // an empty table that reads as "nobody is in intake".
    const filters = parseIntakeFilters({
      source: "Carrier Pigeon",
      temp: "lukewarm",
      reply: "maybe",
    });
    expect(filters.source).toEqual([]);
    expect(filters.temp).toBeNull();
    expect(filters.reply).toBeNull();
  });

  it("keeps owner, stage, temp, reply and the search term", () => {
    expect(
      parseIntakeFilters({
        owner: "user-1",
        stage: "s2",
        temp: "hot",
        reply: "replied",
        q: "  ada  ",
      }),
    ).toEqual({
      source: [],
      temp: "hot",
      owner: "user-1",
      stage: "s2",
      reply: "replied",
      q: "ada",
    });
  });
});

describe("filtersToQueryString", () => {
  it("is empty for empty filters, so 'clear' lands on a clean URL", () => {
    expect(filtersToQueryString(EMPTY_INTAKE_FILTERS)).toBe("");
  });

  it("round-trips through parseIntakeFilters", () => {
    const filters = {
      source: ["UGW", "Instagram"],
      temp: "cold" as const,
      owner: UNASSIGNED_OWNER,
      stage: "s3",
      reply: "awaiting" as const,
      q: "acme",
    };
    const parsed = parseIntakeFilters(
      searchParamsToRecord(new URLSearchParams(filtersToQueryString(filters))),
    );
    expect(parsed).toEqual(filters);
  });
});

// ── buildIntakeRows ─────────────────────────────────────────────────────────
describe("buildIntakeRows", () => {
  it("attaches stage, temperature, reply state, last touch, age, owner and note", () => {
    const [row] = rowsFor(
      [
        lead({
          id: "lead-1",
          current_stage_id: "s2",
          stage_entered_at: daysBefore(3),
          assigned_to: "user-2",
          last_outbound_at: daysBefore(4),
          last_inbound_at: daysBefore(1),
        }),
      ],
      { "lead-1": "  Called, sending the LOE  " },
    );

    expect(row.stage?.name).toBe("Consultation Scheduled");
    expect(row.temperature.level).toBe("hot");
    expect(row.reply).toBe("replied");
    expect(row.lastTouchAt).toBe(daysBefore(1));
    expect(row.daysInStage).toBe(3);
    expect(row.owner?.displayName).toBe("Rebecca Beliard");
    expect(row.latestNote).toBe("Called, sending the LOE");
    expect(row.stale).toBe(false);
  });

  it("marks a lead stale once it passes its stage's aging threshold", () => {
    const [fresh] = rowsFor([lead({ current_stage_id: "s2", stage_entered_at: daysBefore(5) })]);
    const [stale] = rowsFor([lead({ current_stage_id: "s2", stage_entered_at: daysBefore(6) })]);
    // s2's threshold is 5 days: five days in is not yet past it, six is.
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
  });

  it("never marks a stage with no threshold stale", () => {
    const noThreshold = [stage({ id: "s1", order_index: 1, category: "open", aging_threshold_days: null })];
    const [row] = buildIntakeRows({
      leads: [lead({ stage_entered_at: daysBefore(400) })],
      stages: noThreshold,
      members: [],
      now: NOW,
    });
    expect(row.stale).toBe(false);
    expect(agingThresholdOf(row.stage)).toBe(7);
  });

  it("leaves owner null for an unassigned lead and for an unresolvable assignee", () => {
    const [unassigned] = rowsFor([lead({ assigned_to: null })]);
    const [ghost] = rowsFor([lead({ assigned_to: "user-does-not-exist" })]);
    expect(unassigned.owner).toBeNull();
    expect(ghost.owner).toBeNull();
    // The raw id survives on the lead, so the table can still say "assigned".
    expect(ghost.lead.assigned_to).toBe("user-does-not-exist");
  });

  it("tolerates a lead whose stage isn't in the list", () => {
    const [row] = rowsFor([lead({ current_stage_id: "gone" })]);
    expect(row.stage).toBeNull();
    expect(row.temperature.level).toBeTruthy();
  });
});

// ── applyFilters ────────────────────────────────────────────────────────────
describe("applyFilters", () => {
  const rows = rowsFor(
    [
      lead({
        id: "a",
        first_name: "Ada",
        referral_source: "UGW",
        referral_detail: "Event (UGW 2026)",
        assigned_to: "user-1",
        current_stage_id: "s1",
        last_inbound_at: daysBefore(1),
        mark_text: "LOVELACE",
      }),
      lead({
        id: "b",
        first_name: "Grace",
        last_name: "Hopper",
        referral_source: "Instagram",
        assigned_to: null,
        current_stage_id: "s3",
        last_outbound_at: daysBefore(40),
      }),
      lead({
        id: "c",
        first_name: "Alan",
        last_name: "Turing",
        business_name: "Bletchley LLC",
        referral_source: null,
        assigned_to: "user-2",
        current_stage_id: "s2",
        temperature: "cold",
      }),
    ],
    { c: "Waiting on the specimen" },
  );

  function ids(filtered: IntakeRow[]): string[] {
    return filtered.map((row) => row.lead.id);
  }

  it("returns everything when no filter is set", () => {
    expect(ids(applyFilters(rows, EMPTY_INTAKE_FILTERS))).toEqual(["a", "b", "c"]);
  });

  it("ORs within Source and excludes rows with no source at all", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, source: ["UGW", "Instagram"] }))).toEqual([
      "a",
      "b",
    ]);
    // `c` has referral_source null — it is NOT silently bucketed as Inbound
    // here, because the Source column shows "—" for it.
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, source: ["Inbound"] }))).toEqual([]);
  });

  it("filters by temperature, including a hand-set override", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "hot" }))).toEqual(["a"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "cold" }))).toEqual(["b", "c"]);
  });

  it("filters by owner, with a sentinel for unassigned", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, owner: "user-2" }))).toEqual(["c"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, owner: UNASSIGNED_OWNER }))).toEqual(["b"]);
  });

  it("filters by stage and by reply state", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, stage: "s3" }))).toEqual(["b"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, reply: "replied" }))).toEqual(["a"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, reply: "awaiting" }))).toEqual(["b"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, reply: "unknown" }))).toEqual(["c"]);
  });

  it("searches name, business, mark, referral detail and the latest note", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, q: "hopper" }))).toEqual(["b"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, q: "bletchley" }))).toEqual(["c"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, q: "lovelace" }))).toEqual(["a"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, q: "ugw 2026" }))).toEqual(["a"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, q: "specimen" }))).toEqual(["c"]);
  });

  it("ANDs across controls", () => {
    expect(
      ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, source: ["UGW"], temp: "cold" })),
    ).toEqual([]);
  });

  it("does not mutate the input", () => {
    const before = ids(rows);
    applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "hot" });
    expect(ids(rows)).toEqual(before);
  });
});

// ── sortRows ────────────────────────────────────────────────────────────────
describe("sortRows", () => {
  const rows = rowsFor([
    // warm, touched 10 days ago
    lead({ id: "warm", current_stage_id: "s1", last_activity_at: daysBefore(10), stage_entered_at: daysBefore(10) }),
    // hot (replied yesterday), touched recently
    lead({ id: "hotRecent", current_stage_id: "s1", last_inbound_at: daysBefore(1), stage_entered_at: daysBefore(1) }),
    // hot override, never touched → longest awaiting of the two hots
    lead({ id: "hotNever", current_stage_id: "s1", temperature: "hot", stage_entered_at: daysBefore(40) }),
    // cold: a nurture stage AND stale enough that rule 2's "active in stage"
    // clause no longer rescues it (s3's threshold is 30 days).
    lead({ id: "cold", current_stage_id: "s3", last_activity_at: daysBefore(35), stage_entered_at: daysBefore(35) }),
  ]);

  function ids(sorted: IntakeRow[]): string[] {
    return sorted.map((row) => row.lead.id);
  }

  it("defaults to hot first, then longest awaiting", () => {
    expect(DEFAULT_SORT).toEqual({ key: "temp", dir: "desc" });
    expect(ids(sortRows(rows, DEFAULT_SORT.key, DEFAULT_SORT.dir))).toEqual([
      // never-touched hot outranks the hot that replied yesterday
      "hotNever",
      "hotRecent",
      "warm",
      "cold",
    ]);
  });

  it("reverses on ascending", () => {
    expect(ids(sortRows(rows, "temp", "asc"))).toEqual(["cold", "warm", "hotNever", "hotRecent"]);
  });

  it("sorts by age in stage", () => {
    expect(ids(sortRows(rows, "age", "desc"))).toEqual(["hotNever", "cold", "warm", "hotRecent"]);
  });

  it("sinks rows with no value to the bottom in BOTH directions", () => {
    const mixed = rowsFor([
      lead({ id: "has", nurture_last_sent_at: daysBefore(3) }),
      lead({ id: "none" }),
      lead({ id: "older", nurture_last_sent_at: daysBefore(9) }),
    ]);
    expect(ids(sortRows(mixed, "nurture", "desc")).at(-1)).toBe("none");
    expect(ids(sortRows(mixed, "nurture", "asc")).at(-1)).toBe("none");
  });

  it("does not mutate the input array", () => {
    const before = ids(rows);
    sortRows(rows, "lead", "asc");
    expect(ids(rows)).toEqual(before);
  });
});

// ── computeIntakeKpis ───────────────────────────────────────────────────────
describe("computeIntakeKpis", () => {
  it("counts the six numbers from the filtered rows", () => {
    const rows = rowsFor([
      lead({ id: "a", last_inbound_at: daysBefore(1), assigned_to: "user-1", current_stage_id: "s1" }),
      lead({
        id: "b",
        current_stage_id: "s3",
        stage_entered_at: daysBefore(35),
        last_activity_at: daysBefore(35),
        assigned_to: "user-1",
      }),
      lead({
        id: "c",
        current_stage_id: "s2",
        stage_entered_at: daysBefore(20),
        last_activity_at: daysBefore(20),
        assigned_to: null,
      }),
    ]);

    expect(computeIntakeKpis(rows)).toEqual({
      hot: 1, // a replied yesterday
      warm: 1, // c: 20 days quiet is past s2's window but short of the 30-day cold line
      cold: 1, // b sits on a nurture stage and hasn't been touched in 35 days
      awaitingUs: 1, // only a has a newer inbound than outbound
      unassigned: 1,
      stale: 2, // c is 20 days into a 5-day stage, b 35 days into a 30-day one
    });
  });

  it("is all zeroes for no rows", () => {
    expect(computeIntakeKpis([])).toEqual({
      hot: 0,
      warm: 0,
      cold: 0,
      awaitingUs: 0,
      unassigned: 0,
      stale: 0,
    });
  });
});

describe("parseIntakeViewState", () => {
  it("defaults to the table grouped by stage", () => {
    expect(parseIntakeViewState({})).toEqual(DEFAULT_VIEW_STATE);
  });

  it("reads the canvas's two board URLs", () => {
    expect(parseIntakeViewState({ view: "board" })).toEqual({ view: "board", group: "stage" });
    expect(parseIntakeViewState({ view: "board", group: "owner" })).toEqual({
      view: "board",
      group: "owner",
    });
  });

  it("falls back rather than rendering nothing for a value it doesn't know", () => {
    // ?view=kanban should show the list, not a blank screen.
    expect(parseIntakeViewState({ view: "kanban", group: "temperature" })).toEqual(
      DEFAULT_VIEW_STATE,
    );
  });
});

describe("intakeQueryString / intakeHref", () => {
  it("leaves the default view out of the URL entirely", () => {
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, DEFAULT_VIEW_STATE)).toBe("");
    expect(intakeHref(EMPTY_INTAKE_FILTERS, DEFAULT_VIEW_STATE)).toBe("/dashboard/intake/");
  });

  it("spells out a board, and its grouping only when it isn't the default", () => {
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { view: "board", group: "stage" })).toBe(
      "/dashboard/intake/?view=board",
    );
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { view: "board", group: "owner" })).toBe(
      "/dashboard/intake/?view=board&group=owner",
    );
  });

  it("drops the grouping on the table, where it changes nothing a reader can see", () => {
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { view: "table", group: "owner" })).toBe("");
  });

  it("carries the filters alongside the view, so a saved board stays filtered", () => {
    const href = intakeHref(
      { ...EMPTY_INTAKE_FILTERS, source: ["UGW"], temp: "hot" },
      { view: "board", group: "owner" },
    );
    expect(href).toBe("/dashboard/intake/?source=UGW&temp=hot&view=board&group=owner");

    // And it round-trips: the saved link parses back to what was saved.
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseIntakeFilters(params).source).toEqual(["UGW"]);
    expect(parseIntakeViewState(params)).toEqual({ view: "board", group: "owner" });
  });
});
