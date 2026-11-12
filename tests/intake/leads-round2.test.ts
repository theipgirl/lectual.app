import { describe, it, expect } from "vitest";
import { duplicateTitle, findDuplicates } from "@/lib/intake/duplicates";
import { leavesSet } from "@/lib/intake/sets";
import { boardModel, emptyStagesLabel } from "@/lib/intake/board-columns";
import { buildIntakeRows, applyFilters, EMPTY_INTAKE_FILTERS, parseIntakeFilters, filtersToQueryString } from "@/lib/intake/rows";
import { chipCountsWithin } from "@/lib/intake/leads-view";
import { REFERRAL_SOURCES } from "@/lib/intake";
import { INTAKE_REFERRAL_SOURCE } from "@/lib/intake-forms/public-submit";
import type { Lead, Stage } from "@/lib/pipeline";

const NOW = new Date("2026-11-10T14:30:00Z");
const stage = (id: string, name: string, order: number, category = "open") => ({ id, org_id: "o", name, order_index: order, category, aging_threshold_days: null }) as unknown as Stage;
const STAGES = [stage("fu", "Follow-Up", 1), stage("pnc", "Potential New Client", 2), stage("pre", "Preliminary Search", 3), stage("und", "Undecided / Questions", 4), stage("loe", "LOE & Invoice Sent", 5), stage("nur", "Long-Term Nurture", 6, "nurture"), stage("won", "Signed", 7, "won"), stage("lost", "Lost", 8, "lost")];
const lead = (id: string, st: string, over: Record<string, unknown> = {}) =>
  ({ id, org_id: "o", first_name: id, last_name: "Tester", email: `${id}@x.test`, current_stage_id: st, stage_entered_at: NOW.toISOString(), assigned_to: null, lane: null, ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null, referral_source: null, ...over }) as unknown as Lead;
const rowsOf = (leads: Lead[]) => buildIntakeRows({ leads, stages: STAGES, members: [], now: NOW });

describe("possible duplicates", () => {
  it("same email (any case) or same first + last name, among OPEN leads only, never itself", () => {
    const leads = [
      lead("a", "pnc", { email: "Ana@X.test" }),
      lead("b", "fu", { email: "ana@x.test", first_name: "Bea" }),
      lead("c", "pnc", { first_name: "Cy", last_name: "Park", email: "c1@x.test" }),
      lead("d", "fu", { first_name: " cy ", last_name: "PARK", email: "c2@x.test" }),
      lead("n", "nur", { email: "ana@x.test" }),
      lead("lost", "lost", { email: "ana@x.test" }),
      lead("solo", "pnc"),
    ];
    const d = findDuplicates(leads.filter((l) => ["pnc", "fu"].includes(l.current_stage_id)), leads, STAGES);
    expect(Object.keys(d).sort()).toEqual(["a", "b", "c", "d"]);
    // a nurture or lost lead on screen IS compared with the open pool, never the other way round
    expect(Object.keys(findDuplicates([leads[4], leads[5]], leads, STAGES)).sort()).toEqual(["lost", "n"]);
    expect(d.a).toMatchObject({ leadId: "b", stageName: "Follow-Up" });
    expect(d.b).toMatchObject({ leadId: "a", stageName: "Potential New Client" });
    expect(d.c.leadId).toBe("d");
    expect(duplicateTitle(d.a)).toContain("in Follow-Up");
  });

  it("a match needs both name parts and a real email; a lost lead on screen is compared with the open pool", () => {
    const pool = [lead("x", "pnc", { first_name: "Dee", last_name: "", email: "" }), lead("y", "pnc", { first_name: "Dee", last_name: "", email: "" })];
    expect(findDuplicates(pool, pool, STAGES)).toEqual({});
    const open = lead("o", "pnc", { email: "same@x.test" });
    const lost = lead("l", "lost", { email: "SAME@x.test" });
    expect(Object.keys(findDuplicates([lost], [open, lost], STAGES))).toEqual(["l"]);
  });

  it("the chip counts duplicates inside the set; ?dup=1 round-trips", () => {
    const rows = rowsOf([lead("a", "pnc"), lead("b", "pnc")]);
    const counts = chipCountsWithin(rows, { approvals: undefined, decisionsRead: false, agentRead: false, duplicates: { a: { leadId: "b", name: "b", stageName: "x" } } });
    expect(counts.duplicates).toBe(1);
    expect(parseIntakeFilters({ dup: "1" }).dup).toBe(true);
    expect(filtersToQueryString({ ...EMPTY_INTAKE_FILTERS, dup: true })).toBe("dup=1");
    expect(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS })).toHaveLength(2);
  });
});

describe("the quiet Moved mark", () => {
  it("a stage move leaves the set only when the new stage is not of the set's kind (or moves a not-started lead past first contact)", () => {
    expect(leavesSet("working", "open", false)).toBe(false);
    expect(leavesSet("working", "nurture", false)).toBe(true);
    expect(leavesSet("open", "lost", false)).toBe(true);
    expect(leavesSet("not-started", "open", false)).toBe(false);
    expect(leavesSet("not-started", "open", true)).toBe(true);
    expect(leavesSet("event", "open", true)).toBe(true);
    expect(leavesSet("nurture", "nurture", false)).toBe(false);
    expect(leavesSet("nurture", "open", true)).toBe(true);
    expect(leavesSet("lost", "open", false)).toBe(true);
  });
});

describe("the board: empty stages are named, and Long-Term Nurture is always the last column", () => {
  const intake = STAGES.filter((s) => s.category === "open" || s.category === "nurture");
  const input = (rows: ReturnType<typeof rowsOf>, nurtureRows: ReturnType<typeof rowsOf> | null) => ({
    rows,
    stages: intake,
    members: [],
    group: "stage" as const,
    pinned: [],
    extra: {},
    showEmpty: false,
    nurture: nurtureRows ? { rows: nurtureRows, stage: STAGES.find((s) => s.id === "nur")! } : null,
  });

  it("names every empty stage, 'Undecided / Questions' included, and not the nurture stage", () => {
    const m = boardModel(input(rowsOf([lead("a", "pnc")]), rowsOf([lead("n1", "nur")])));
    expect(m.empty.map((e) => e.label)).toEqual(["Follow-Up", "Preliminary Search", "Undecided / Questions", "LOE & Invoice Sent"]);
    expect(emptyStagesLabel(4, false, m.empty.map((e) => e.label))).toBe("4 empty stages: Follow-Up, Preliminary Search, Undecided / Questions, LOE & Invoice Sent · Show");
    expect(emptyStagesLabel(1, true, ["x"])).toBe("1 empty stage · Hide");
  });

  it("the nurture column ends the board, shows 15 then more, is quiet, and a drop on it is an ordinary stage move", () => {
    const nurtureRows = rowsOf(Array.from({ length: 40 }, (_, i) => lead(`n${i}`, "nur")));
    const m = boardModel(input(rowsOf([lead("a", "pnc")]), nurtureRows));
    const last = m.columns[m.columns.length - 1];
    expect(last).toMatchObject({ key: "nur", label: "Long-Term Nurture", count: 40, left: 25, quiet: true, drop: { kind: "stage", stageId: "nur" } });
    expect(last.shown).toHaveLength(15);
    // Even with every empty stage shown, it stays last.
    const all = boardModel({ ...input(rowsOf([lead("a", "pnc")]), nurtureRows), showEmpty: true });
    expect(all.columns[all.columns.length - 1].key).toBe("nur");
    // With none (the Nurture set draws it as a stage column; the owner board has no such column) there is no extra column.
    expect(boardModel(input(rowsOf([lead("a", "pnc")]), null)).columns.some((c) => c.quiet)).toBe(false);
  });

  it("an empty nurture column is still drawn (a place to drop)", () => {
    const m = boardModel(input(rowsOf([lead("a", "pnc")]), []));
    expect(m.columns[m.columns.length - 1]).toMatchObject({ key: "nur", count: 0, shown: [] });
  });
});

describe("sources and sets", () => {
  it("'Intake form' is a referral source (what the public form writes)", () => {
    expect(REFERRAL_SOURCES).toContain("Intake form");
    expect(REFERRAL_SOURCES).toContain(INTAKE_REFERRAL_SOURCE);
  });
});
