import { describe, expect, it } from "vitest";
import { assistantColumnShown, assistantItems } from "@/lib/intake/assistant-column";
import { COL_ORDER, DEFAULT_COL_WIDTHS, MAX_COL, MENU_COL_WIDTH, MIN_COL, NEXT_MIN_WIDTH, clampWidth, colWidth, parseColSizes, resizedWidth, tableMinWidth, visibleColumns, withoutCol } from "@/lib/intake/col-widths";
import { compareRows, countText, shapeCompareSide, type CountRead } from "@/lib/intake/compare";
import { loadCompare, type CompareDeps, type CompareLeadRow } from "@/lib/intake/compare-load";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import type { IntakeRow } from "@/lib/intake/rows";

const row = (over: Partial<IntakeRow>): IntakeRow => ({ agentMove: undefined, temperature: { value: null, source: "suggested", reason: "" }, ...over }) as unknown as IntakeRow;
const move = { activityId: "a1", text: "Moved automatically · LOE sent Oct 20", tooltip: "Evidence", why: "", movedAt: "", today: false };

describe("assistant column", () => {
  it("lists the move, then the Long-Term Nurture suggestion; Needs attorney is not here", () => {
    const r = row({ agentMove: move, temperature: { value: "cold", source: "suggested", reason: "x", suggestion: "long_term_nurture" } as IntakeRow["temperature"] });
    expect(assistantItems(r).map((i) => i.kind)).toEqual(["moved", "suggestion"]);
    expect(assistantItems(r)[0].text).toBe("Moved automatically · LOE sent Oct 20");
    expect(assistantItems(row({}))).toEqual([]);
  });
  it("is drawn only while some row in view has something", () => {
    expect(assistantColumnShown([row({}), row({})])).toBe(false);
    expect(assistantColumnShown([row({}), row({ agentMove: move })])).toBe(true);
    expect(assistantColumnShown([])).toBe(false);
  });
});

describe("column widths (the Sheet's mechanism)", () => {
  it("draws Owner and Assistant activity only when needed", () => {
    expect(visibleColumns({ owner: false, assistant: false })).toEqual(["lead", "stage", "temp", "source", "touch", "next"]);
    expect(visibleColumns({ owner: true, assistant: true })).toEqual([...COL_ORDER]);
  });
  it("the defaults with the Assistant column and no Owner column fit 954px (1280 with the rail open)", () => {
    expect(tableMinWidth(visibleColumns({ owner: false, assistant: true }), {})).toBeLessThanOrEqual(954);
    expect(tableMinWidth(visibleColumns({ owner: false, assistant: true }), {})).toBeGreaterThan(MENU_COL_WIDTH);
  });
  it("Next step is the one flexible column and is counted at its minimum", () => {
    expect(DEFAULT_COL_WIDTHS.next).toBeNull();
    expect(colWidth({}, "next")).toBeNull();
    expect(tableMinWidth(["next"], {})).toBe(MENU_COL_WIDTH + NEXT_MIN_WIDTH);
    expect(tableMinWidth(["lead"], { lead: 300 })).toBe(MENU_COL_WIDTH + 300);
  });
  it("a stored width overrides the default and is clamped", () => {
    expect(colWidth({ lead: 300 }, "lead")).toBe(300);
    expect(resizedWidth(100, 16)).toBe(116);
    expect(resizedWidth(MIN_COL, -50)).toBe(MIN_COL);
    expect(clampWidth(5000)).toBe(MAX_COL);
  });
  it("reads storage defensively: garbage, wrong types and unknown columns are dropped", () => {
    expect(parseColSizes(null)).toEqual({});
    expect(parseColSizes("not json")).toEqual({});
    expect(parseColSizes("[1,2]")).toEqual({});
    expect(parseColSizes(JSON.stringify({ lead: 200, stage: "wide", bogus: 5, temp: 99999 }))).toEqual({ lead: 200, temp: MAX_COL });
  });
  it("Home restores one column", () => {
    expect(withoutCol({ lead: 200, stage: 150 }, "lead")).toEqual({ stage: 150 });
  });
});

describe("the temperature pill words", () => {
  it("a person's level is plain; a suggestion carries the word", () => {
    expect(temperaturePill({ value: "warm", source: "person", reason: "r" })!.text).toBe("Warm");
    expect(temperaturePill({ value: "warm", source: "suggested", reason: "r" })!.text).toBe("Warm · suggested");
  });
});

const lead = (id: string, over: Partial<CompareLeadRow> = {}): CompareLeadRow => ({
  id, first_name: "Dominique", last_name: "Okonkwo", business_name: "Okonkwo Textiles", mark_text: null, email: "d@example.test", referral_source: "UGW", created_at: "2026-09-03T15:00:00Z", current_stage_id: "s1", ...over,
});
const ok = (count: number): CountRead => ({ status: "ok", count });

describe("compare panel data", () => {
  it("shapes a side with dashes for blanks and the mark before the business", () => {
    const side = shapeCompareSide(lead("a", { mark_text: "OKO", business_name: "Okonkwo Textiles", referral_source: null }), { status: "ok", name: "Follow-Up" }, { timeline: ok(4), tasks: ok(0), proposals: ok(1) }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    expect(side).toMatchObject({ status: "ok", name: "Dominique Okonkwo", business: "OKO", stage: "Follow-Up", source: "—", created: "Sep\u00a03" });
    const odd = shapeCompareSide(lead("a", { created_at: "nope" }), { status: "none" }, { timeline: ok(0), tasks: ok(0), proposals: { status: "off" } }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    expect(odd.status === "ok" && odd.created).toBe("—");
  });
  it("a lead with no stage is a dash; a failed stage read says it couldn't load", () => {
    const none = shapeCompareSide(lead("a", { current_stage_id: null }), { status: "none" }, { timeline: ok(0), tasks: ok(0), proposals: { status: "off" } }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    const failed = shapeCompareSide(lead("a"), { status: "unavailable" }, { timeline: ok(0), tasks: ok(0), proposals: { status: "off" } }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    expect(none.status === "ok" && none.stage).toBe("—");
    expect(failed.status === "ok" && failed.stage).toBe("Couldn't load");
  });
  it("a failed count says it couldn't load, never 0; proposals are left out for a firm without them", () => {
    const a = shapeCompareSide(lead("a"), { status: "ok", name: "S" }, { timeline: { status: "unavailable" }, tasks: ok(0), proposals: { status: "off" } }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    const b = shapeCompareSide(lead("b"), { status: "unavailable" }, { timeline: ok(2), tasks: ok(1), proposals: { status: "off" } }, { now: new Date("2026-11-10T14:00:00Z"), timeZone: "America/New_York" });
    if (a.status !== "ok" || b.status !== "ok") throw new Error("shape");
    expect(countText({ status: "unavailable" })).toBe("Couldn't load");
    const rows = compareRows(a, b);
    expect(rows.find((r) => r.key === "timeline")).toMatchObject({ a: "Couldn't load", b: "2", failed: true });
    expect(rows.find((r) => r.key === "tasks")).toMatchObject({ a: "0", b: "1", failed: false });
    expect(rows.find((r) => r.key === "stage")).toMatchObject({ b: "Couldn't load", failed: true });
    expect(rows.some((r) => r.key === "proposals")).toBe(false);
    expect(rows.find((r) => r.key === "email")!.same).toBe(true);
    expect(rows.find((r) => r.key === "created")!.same).toBe(false);
  });
});

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function deps(over: Partial<CompareDeps> = {}): CompareDeps {
  return {
    readLead: async (id) => lead(id),
    readStageName: async () => "Follow-Up",
    now: new Date("2026-11-10T14:00:00Z"),
    timeZone: "America/New_York",
    count: async () => 3,
    proposalsOn: async () => true,
    ...over,
  };
}

describe("loadCompare (reads through injected scoped reads)", () => {
  it("returns both sides with their counts", async () => {
    const r = await loadCompare(A, B, deps());
    expect(r.ok && r.data.a.status === "ok" && r.data.a.timeline).toEqual({ status: "ok", count: 3 });
  });
  it("each count fails on its own", async () => {
    const r = await loadCompare(A, B, deps({ count: async (t) => { if (t === "crm_task") throw new Error("boom"); return 1; } }));
    if (!r.ok || r.data.a.status !== "ok") throw new Error("shape");
    expect(r.data.a.tasks).toEqual({ status: "unavailable" });
    expect(r.data.a.timeline).toEqual({ status: "ok", count: 1 });
  });
  it("proposals are off without the feature, and an unreadable module list fails closed", async () => {
    for (const proposalsOn of [async () => false, async () => { throw new Error("x"); }]) {
      const r = await loadCompare(A, B, deps({ proposalsOn }));
      if (!r.ok || r.data.a.status !== "ok") throw new Error("shape");
      expect(r.data.a.proposals).toEqual({ status: "off" });
    }
  });
  it("a missing lead (another firm's reads the same) is 'gone'; a failed lead read fails the panel with a fixed sentence", async () => {
    const gone = await loadCompare(A, B, deps({ readLead: async (id) => (id === B ? null : lead(id)) }));
    expect(gone.ok && gone.data.b).toEqual({ status: "gone", id: B });
    const failed = await loadCompare(A, B, deps({ readLead: async () => { throw new Error("secret db text"); } }));
    expect(failed).toEqual({ ok: false, error: "Can't show these leads right now. Close this and try again." });
  });
  it("stage: none without current_stage_id (no read), unavailable when the read throws, none when the row is gone", async () => {
    let stageReads = 0;
    const base = { readStageName: async () => { stageReads++; return "Follow-Up"; } };
    const noStage = await loadCompare(A, B, deps({ ...base, readLead: async (id) => lead(id, { current_stage_id: null }) }));
    expect(noStage.ok && noStage.data.a.status === "ok" && noStage.data.a.stage).toBe("—");
    expect(stageReads).toBe(0);
    const failed = await loadCompare(A, B, deps({ readStageName: async () => { throw new Error("x"); } }));
    expect(failed.ok && failed.data.a.status === "ok" && failed.data.a.stage).toBe("Couldn't load");
    const gone = await loadCompare(A, B, deps({ readStageName: async () => null }));
    expect(gone.ok && gone.data.a.status === "ok" && gone.data.a.stage).toBe("—");
  });
  it("refuses ids that are not two different uuids, reading nothing", async () => {
    let reads = 0;
    const d = deps({ readLead: async (id) => { reads++; return lead(id); } });
    for (const [a, b] of [["x", B], [A, A], [A, "../etc"]]) expect((await loadCompare(a, b, d)).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
