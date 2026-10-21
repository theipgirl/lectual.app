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
      needsRebecca: false,
      q: "ada",
    });
  });
});

describe("needsRebecca filter param", () => {
  it("parses ?needs=rebecca and ignores any other value", () => {
    expect(parseIntakeFilters({ needs: "rebecca" }).needsRebecca).toBe(true);
    expect(parseIntakeFilters({ needs: "everyone" }).needsRebecca).toBe(false);
    expect(parseIntakeFilters({}).needsRebecca).toBe(false);
  });

  it("serialises only when on", () => {
    expect(filtersToQueryString({ ...EMPTY_INTAKE_FILTERS, needsRebecca: true })).toBe("needs=rebecca");
    expect(filtersToQueryString(EMPTY_INTAKE_FILTERS)).toBe("");
  });
});

describe("filtersToQueryString", () => {
  it("is empty for empty filters, so 'clear' lands on a clean URL", () => {
    expect(filtersToQueryString(EMPTY_INTAKE_FILTERS)).toBe("");
  });

  it("round-trips through parseIntakeFilters", () => {
    const filters = {
      source: ["UGW", "Instagram"],
      temp: "none" as const,
      owner: UNASSIGNED_OWNER,
      stage: "s3",
      reply: "awaiting" as const,
      needsRebecca: true,
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
    expect(row.temperature).toMatchObject({ value: "hot", source: "suggested" });
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
    expect(row.temperature.reason).toBeTruthy();
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
        // The old hand-set column is ignored: nothing can clear it any more.
        temperature: "hot",
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

  it("filters by the effective temperature; a leftover hand-set column is ignored", () => {
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "hot" }))).toEqual(["a"]);
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "cold" }))).toEqual(["b"]);
    // c has no touch, no facts and a stale `temperature: "hot"` column: Not routed, not hot.
    expect(ids(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, temp: "none" }))).toEqual(["c"]);
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
    // warm: touched 6 days ago (between the 3-day hot and 10-day cold lines)
    lead({ id: "warm", current_stage_id: "s1", last_activity_at: daysBefore(6), stage_entered_at: daysBefore(10) }),
    // hot (replied yesterday), touched recently
    lead({ id: "hotRecent", current_stage_id: "s1", last_inbound_at: daysBefore(1), stage_entered_at: daysBefore(1) }),
    // never touched; the old hand-set `temperature` column is ignored, so this is Not routed
    lead({ id: "neverTouched", current_stage_id: "s1", temperature: "hot", stage_entered_at: daysBefore(40) }),
    // cold: a nurture stage, and untouched for 35 days besides.
    lead({ id: "cold", current_stage_id: "s3", last_activity_at: daysBefore(35), stage_entered_at: daysBefore(35) }),
  ]);

  function ids(sorted: IntakeRow[]): string[] {
    return sorted.map((row) => row.lead.id);
  }

  it("defaults to the last touch, newest first, never-touched last", () => {
    expect(DEFAULT_SORT).toEqual({ key: "lastTouch", dir: "desc" });
    expect(ids(sortRows(rows, DEFAULT_SORT.key, DEFAULT_SORT.dir))).toEqual([
      "hotRecent", // replied yesterday
      "warm", // touched 6 days ago
      "cold", // touched 35 days ago
      "neverTouched",
    ]);
  });

  it("orders three leads touched yesterday, today and never as today, yesterday, never", () => {
    const three = rowsFor([
      lead({ id: "yesterday", last_activity_at: daysBefore(1) }),
      lead({ id: "never" }),
      lead({ id: "today", last_activity_at: daysBefore(0) }),
    ]);
    expect(ids(sortRows(three, DEFAULT_SORT.key, DEFAULT_SORT.dir))).toEqual(["today", "yesterday", "never"]);
  });

  it("sorts temperature hot, warm, cold and puts Not routed last in both directions", () => {
    expect(ids(sortRows(rows, "temperature", "desc"))).toEqual(["hotRecent", "warm", "cold", "neverTouched"]);
    expect(ids(sortRows(rows, "temperature", "asc"))).toEqual(["cold", "warm", "hotRecent", "neverTouched"]);
  });

  describe("the tiebreak follows the sort direction", () => {
    // Same stage on every row, so the `stage` sort ties and the touch decides.
    const tied = rowsFor([
      lead({ id: "old", last_activity_at: daysBefore(8) }),
      lead({ id: "never" }),
      lead({ id: "new", last_activity_at: daysBefore(1) }),
    ]);

    it("descending: newest touch first, never-touched last", () => {
      expect(ids(sortRows(tied, "stage", "desc"))).toEqual(["new", "old", "never"]);
    });

    it("ascending: oldest touch first, never-touched first", () => {
      expect(ids(sortRows(tied, "stage", "asc"))).toEqual(["never", "old", "new"]);
    });

    it("still sinks a row with no value on the active column, in both directions", () => {
      const withSource = rowsFor([
        lead({ id: "hasSource", referral_source: "UGW", last_activity_at: daysBefore(9) }),
        lead({ id: "noSource", last_activity_at: daysBefore(1) }),
      ]);
      expect(ids(sortRows(withSource, "source", "desc")).at(-1)).toBe("noSource");
      expect(ids(sortRows(withSource, "source", "asc")).at(-1)).toBe("noSource");
    });
  });

  it("sorts by age in stage", () => {
    expect(ids(sortRows(rows, "age", "desc"))).toEqual(["neverTouched", "cold", "warm", "hotRecent"]);
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
        last_activity_at: daysBefore(6),
        assigned_to: null,
      }),
    ]);

    expect(computeIntakeKpis(rows)).toEqual({
      hot: 1, // a replied yesterday
      warm: 1, // c: touched 6 days ago, between the 3-day hot and 10-day cold lines
      cold: 1, // b sits on a nurture stage and hasn't been touched in 35 days
      awaitingUs: 1, // only a has a newer inbound than outbound
      unassigned: 1,
      stale: 2, // c is 20 days into a 5-day stage, b 35 days into a 30-day one (stale is stage aging, not temperature)
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
    expect(parseIntakeViewState({ view: "board" })).toEqual({ view: "board", group: "stage", sort: DEFAULT_SORT });
    expect(parseIntakeViewState({ view: "board", group: "owner" })).toEqual({
      view: "board",
      group: "owner",
      sort: DEFAULT_SORT,
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
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { view: "board", group: "stage", sort: DEFAULT_SORT })).toBe(
      "/dashboard/intake/?view=board",
    );
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { view: "board", group: "owner", sort: DEFAULT_SORT })).toBe(
      "/dashboard/intake/?view=board&group=owner",
    );
  });

  it("drops the grouping on the table, where it changes nothing a reader can see", () => {
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { view: "table", group: "owner", sort: DEFAULT_SORT })).toBe("");
  });

  it("carries the filters alongside the view, so a saved board stays filtered", () => {
    const href = intakeHref(
      { ...EMPTY_INTAKE_FILTERS, source: ["UGW"], temp: "hot" },
      { view: "board", group: "owner", sort: DEFAULT_SORT },
    );
    expect(href).toBe("/dashboard/intake/?source=UGW&temp=hot&view=board&group=owner");

    // And it round-trips: the saved link parses back to what was saved.
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseIntakeFilters(params).source).toEqual(["UGW"]);
    expect(parseIntakeViewState(params)).toEqual({ view: "board", group: "owner", sort: DEFAULT_SORT });
  });
});

describe("the sort in the URL", () => {
  const sortOf = (params: Record<string, string>) => parseIntakeViewState(params).sort;

  it("leaves the default sort out of the URL", () => {
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, DEFAULT_VIEW_STATE)).toBe("");
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, sort: { key: "lastTouch", dir: "desc" } })).toBe("");
  });

  it("writes a non-default sort as ?sort=&dir= and reads it back", () => {
    const state = { ...DEFAULT_VIEW_STATE, sort: { key: "lead" as const, dir: "asc" as const } };
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, state)).toBe("sort=lead&dir=asc");
    expect(sortOf({ sort: "lead", dir: "asc" })).toEqual({ key: "lead", dir: "asc" });
    // The default key in the other direction is not the default sort.
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, sort: { key: "lastTouch", dir: "asc" } })).toBe(
      "sort=lastTouch&dir=asc",
    );
  });

  it("falls back to the default sort for a bad key", () => {
    expect(sortOf({ sort: "colour", dir: "asc" })).toEqual(DEFAULT_SORT);
    expect(sortOf({ dir: "asc" })).toEqual(DEFAULT_SORT);
  });

  it("takes the column's natural first direction for a missing or bad direction", () => {
    expect(sortOf({ sort: "lead" })).toEqual({ key: "lead", dir: "asc" });
    expect(sortOf({ sort: "lead", dir: "sideways" })).toEqual({ key: "lead", dir: "asc" });
    expect(sortOf({ sort: "temperature" })).toEqual({ key: "temperature", dir: "desc" });
    expect(sortOf({ sort: "age", dir: "up" })).toEqual({ key: "age", dir: "desc" });
    expect(sortOf({ sort: "reply" })).toEqual({ key: "reply", dir: "desc" });
    expect(sortOf({ sort: "nurture" })).toEqual({ key: "nurture", dir: "desc" });
    expect(sortOf({ sort: "owner" })).toEqual({ key: "owner", dir: "asc" });
  });

  it("reads the old temp and lane sort keys as the merged temperature sort", () => {
    expect(sortOf({ sort: "temp", dir: "asc" })).toEqual({ key: "temperature", dir: "asc" });
    expect(sortOf({ sort: "lane" })).toEqual({ key: "temperature", dir: "desc" });
  });

  it("round-trips the sort, the filters and the view together", () => {
    const filters = { ...EMPTY_INTAKE_FILTERS, source: ["UGW"], temp: "none" as const, q: "ada" };
    const state = { view: "board" as const, group: "owner" as const, sort: { key: "temperature" as const, dir: "asc" as const } };
    const href = intakeHref(filters, state);
    expect(href).toBe("/dashboard/intake/?source=UGW&temp=none&q=ada&view=board&group=owner&sort=temperature&dir=asc");
    const record = searchParamsToRecord(new URLSearchParams(href.split("?")[1]));
    expect(parseIntakeFilters(record)).toEqual(filters);
    expect(parseIntakeViewState(record)).toEqual(state);
  });

  it("keeps the sort on the table and on both boards", () => {
    const sort = { key: "owner" as const, dir: "desc" as const };
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { view: "table", group: "stage", sort })).toBe("sort=owner&dir=desc");
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { view: "board", group: "stage", sort })).toBe("view=board&sort=owner&dir=desc");
  });
});

describe("the merged temperature filter", () => {
  it("reads ?temp= including none (Not routed)", () => {
    expect(parseIntakeFilters({ temp: "none" }).temp).toBe("none");
    expect(parseIntakeFilters({ temp: "warm" }).temp).toBe("warm");
  });

  it("reads the old ?lane= as an alias, and ?temp= wins when both are present", () => {
    expect(parseIntakeFilters({ lane: "warm" }).temp).toBe("warm");
    expect(parseIntakeFilters({ lane: "none" }).temp).toBe("none");
    expect(parseIntakeFilters({ lane: "cold", temp: "hot" }).temp).toBe("hot");
  });

  it("drops ?lane=suggested and unknown values rather than filtering everything out", () => {
    expect(parseIntakeFilters({ lane: "suggested" }).temp).toBeNull();
    expect(parseIntakeFilters({ temp: "lukewarm" }).temp).toBeNull();
    expect(parseIntakeFilters({ lane: "suggested", temp: "lukewarm" }).temp).toBeNull();
  });

  it("writes only ?temp=, never ?lane=", () => {
    expect(filtersToQueryString({ ...EMPTY_INTAKE_FILTERS, temp: "none" })).toBe("temp=none");
    const parsed = parseIntakeFilters({ lane: "hot" });
    expect(filtersToQueryString(parsed)).toBe("temp=hot");
  });
});

describe("the KPI counts follow the effective temperature", () => {
  it("counts a person's lane over what the activity says, and leaves Not routed out", () => {
    const rows = rowsFor([
      // replied yesterday: the activity says hot, but a person set cold
      lead({ id: "a", last_inbound_at: daysBefore(1), lane: "cold", lane_set_at: daysBefore(0) }),
      lead({ id: "b", lane: "hot", lane_set_at: daysBefore(0) }),
      lead({ id: "c" }), // Not routed
    ]);
    const kpis = computeIntakeKpis(rows);
    expect(kpis).toMatchObject({ hot: 1, warm: 0, cold: 1 });
  });
});
