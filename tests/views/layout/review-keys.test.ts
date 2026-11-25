import { describe, expect, it } from "vitest";
import { REVIEW_LAYOUT_KEYS, applyReviewLayout, layoutKeyOf } from "@/lib/review/layout";
import { applyBoardLayout, laneKey, UNASSIGNED_LANE_KEY } from "@/lib/review/board-layout";
import { COLUMN_IDS, NOTES_PRESENT, columnsFor, customColumnId, type CustomColumnField } from "@/lib/review/sheet-columns";
import { isBuiltinKey, isLayoutKey, parseLayout } from "@/lib/views/layout/validate";
import { layoutOf, resolveLayout } from "@/lib/views/layout/apply";
import type { Lane } from "@/lib/review/lanes";
import type { Layout } from "@/lib/views/layout/types";

const FIELD_ID = "0A1B2C3D-0000-4000-8000-00000000F001";
const MONEY_ID = "0a1b2c3d-0000-4000-8000-00000000f002";
const fields: CustomColumnField[] = [
  { id: FIELD_ID, section: "both", label: "Priority", kind: "choice", position: 0 },
  { id: MONEY_ID, section: "both", label: "Quoted fee", kind: "money", position: 1 },
];
const c = (key: string, over: Partial<Layout[number]> = {}): Layout[number] => ({ key, label: null, hidden: false, width: null, ...over });

describe("the review's column keys are keys the database accepts", () => {
  it("every built-in column has one, valid and distinct (the camel-case ids are snake case)", () => {
    const keys = COLUMN_IDS.map((id) => REVIEW_LAYOUT_KEYS[id]);
    for (const k of keys) expect(isBuiltinKey(k), k).toBe(true);
    expect(new Set(keys).size).toBe(COLUMN_IDS.length);
    expect(REVIEW_LAYOUT_KEYS.legalFeeDue).toBe("legal_fee_due");
    expect(REVIEW_LAYOUT_KEYS.owner).toBe("owner");
  });
  it("a firm column's key is cf: and the field id lowercased, whatever case the id was read in", () => {
    const k = layoutKeyOf(customColumnId(FIELD_ID));
    expect(k).toBe(`cf:${FIELD_ID.toLowerCase()}`);
    expect(isLayoutKey(k)).toBe(true);
  });
});

describe("applyReviewLayout", () => {
  const cols = (money = false) => columnsFor("trademarks", { canSeeMoney: money, canSeeCustomMoney: money, hasNotes: NOTES_PRESENT, customFields: fields });
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it("no layout: the same columns", () => {
    expect(ids(applyReviewLayout(cols(), null))).toEqual(ids(cols()));
  });

  it("orders, renames (header only), hides and sizes; ids and the caller's fields stay", () => {
    const saved: Layout = [c("client"), c("notes", { label: "What happened", width: 260 }), c("status"), c("mark", { hidden: true })];
    const out = applyReviewLayout(cols(), saved);
    expect(ids(out).slice(0, 3)).toEqual(["client", "notes", "status"]);
    expect(ids(out)).not.toContain("mark");
    const notes = out.find((x) => x.id === "notes")!;
    expect(notes).toMatchObject({ header: "What happened", width: 260, id: "notes" });
    expect(out.find((x) => x.id === "status")!.editable).toBe(true);
    // The rest follow in default order.
    expect(ids(out).slice(3)).toEqual(ids(cols()).filter((id) => !["client", "notes", "status", "mark"].includes(id)));
  });

  it("a legal_fee layout key reaches the legalFee column (money viewers); for a non-owner the fee column isn't there to find", () => {
    const saved: Layout = [c("client"), c("legal_fee", { label: "Fee" })];
    expect(applyReviewLayout(cols(true), saved).find((x) => x.id === "legalFee")!.header).toBe("Fee");
    expect(ids(applyReviewLayout(cols(false), saved))).not.toContain("legalFee");
  });

  it("a layout that names a firm Money column adds it for no one but an owner; and the field's key matches in either case", () => {
    const saved: Layout = [c("client"), c(layoutKeyOf(customColumnId(MONEY_ID))), c(layoutKeyOf(customColumnId(FIELD_ID)), { label: "Urgency" })];
    const nonOwner = applyReviewLayout(cols(false), saved);
    expect(ids(nonOwner)).not.toContain(customColumnId(MONEY_ID));
    expect(nonOwner.find((x) => x.id === customColumnId(FIELD_ID))!.header).toBe("Urgency");
    const owner = applyReviewLayout(cols(true), saved);
    expect(ids(owner)).toContain(customColumnId(MONEY_ID));
  });

  it("the Contracts section keeps its own columns: a Trademarks-only key in the layout is ignored there", () => {
    const contracts = columnsFor("contracts", { canSeeMoney: false, hasNotes: NOTES_PRESENT });
    const out = applyReviewLayout(contracts, [c("client"), c("serial"), c("status")]);
    expect(ids(out)).not.toContain("serial");
    expect(ids(out).slice(0, 2)).toEqual(["client", "status"]);
  });

  it("the client column stays first and visible", () => {
    const out = applyReviewLayout(cols(), [c("status"), c("client", { hidden: true })]);
    expect(out[0].id).toBe("client");
  });

  it("a layout saved from what the page resolved reads back to the same columns", () => {
    const first = applyReviewLayout(cols(true), [c("client"), c("next"), c("status", { label: "Stage" })]);
    const defaults = cols(true).map((x) => ({ key: layoutKeyOf(x.id), label: x.header, pinned: x.pinned }));
    const saved = layoutOf(resolveLayout(defaults, [c("client"), c("next"), c("status", { label: "Stage" })]));
    expect(parseLayout(saved)).not.toBeNull();
    expect(ids(applyReviewLayout(cols(true), saved))).toEqual(ids(first));
  });
});

describe("the Board's layout names people", () => {
  const lane = (userId: string | null, name: string): Lane => ({ userId, name, our: [], client: [], count: 0 });
  const A = "0a1b2c3d-0000-4000-8000-0000000000aa";
  const B = "0a1b2c3d-0000-4000-8000-0000000000bb";

  it("a lane's key is u + the member id without dashes (a valid key), or unassigned", () => {
    expect(laneKey(A)).toBe(`u${A.replace(/-/g, "")}`);
    expect(isBuiltinKey(laneKey(A))).toBe(true);
    expect(laneKey(A.toUpperCase())).toBe(laneKey(A));
    expect(laneKey(null)).toBe(UNASSIGNED_LANE_KEY);
    expect(isBuiltinKey(UNASSIGNED_LANE_KEY)).toBe(true);
  });

  it("no layout: the lanes as they are, none hidden", () => {
    const lanes = [lane(A, "Ana"), lane(B, "Bo"), lane(null, "Unassigned")];
    const out = applyBoardLayout(lanes, null);
    expect(out.lanes.map((l) => l.title)).toEqual(["Ana", "Bo", "Unassigned"]);
    expect(out.hidden).toBe(0);
  });

  it("orders and names the people; a person new to the layout comes after; a saved person with no cards today has no lane", () => {
    const lanes = [lane(A, "Ana"), lane(B, "Bo"), lane(null, "Unassigned")];
    const out = applyBoardLayout(lanes, [c(laneKey(B), { label: "Bo (paralegal)" }), c("u" + "f".repeat(32)), c(laneKey(A))]);
    expect(out.lanes.map((l) => l.title)).toEqual(["Bo (paralegal)", "Ana", "Unassigned"]);
    expect(out.lanes.map((l) => l.key)).toEqual([laneKey(B), laneKey(A), UNASSIGNED_LANE_KEY]);
  });

  it("a hidden person is counted, so the page can say so (their records are never silently out of the Board)", () => {
    const lanes = [lane(A, "Ana"), lane(B, "Bo")];
    const out = applyBoardLayout(lanes, [c(laneKey(A), { hidden: true }), c(laneKey(B))]);
    expect(out.lanes.map((l) => l.title)).toEqual(["Bo"]);
    expect(out.hidden).toBe(1);
    // Everything hidden: the standard lanes are drawn and nothing is claimed hidden.
    const all = applyBoardLayout(lanes, [c(laneKey(A), { hidden: true }), c(laneKey(B), { hidden: true })]);
    expect(all.lanes).toHaveLength(2);
    expect(all.hidden).toBe(0);
  });
});
