import { beforeEach, describe, expect, it, vi } from "vitest";
import { valueFor } from "@/lib/custom-columns/rules";
import { fakeDb, matter, mockReviewSources, NOW, state } from "./custom-load-harness";

mockReviewSources();

const FIELD = "00000000-0000-4000-8000-00000000f001";
const fieldRow = { id: FIELD, section: "trademarks", label: "Priority", kind: "choice", options: ["High", "Low"], position: 0 };
const valueOn = (lead: string, choice: string) => ({ id: `v-${lead}`, field_id: FIELD, lead_id: lead, matter_id: null, value_text: null, value_date: null, value_cents: null, value_choice: choice, value_user_id: null, updated_at: "2026-11-01T00:00:00Z" });

/** Answers the custom tables from `values`, the lead table's merge pointers from `merged`, everything else empty. */
function db(values: ReturnType<typeof valueOn>[], merged: { id: string; merged_into_id: string }[] = []) {
  return fakeDb((c) => {
    if (c.table === "crm_custom_field") return { data: [fieldRow] };
    if (c.table === "crm_custom_value") {
      const [col, ids] = c.inn[0];
      return { data: values.filter((v) => ids.includes((v as Record<string, unknown>)[col] as string)) };
    }
    if (c.table === "crm_lead") return { data: merged.filter((m) => c.inn[0][1].includes(m.merged_into_id)) };
    return { data: [] };
  });
}

async function load(options: Parameters<typeof import("@/lib/review/load").loadReview>[1]) {
  const { loadReview } = await import("@/lib/review/load");
  const r = await loadReview(NOW, options);
  if (r.status !== "ok") throw new Error("expected ok");
  return r;
}

beforeEach(() => {
  // One open TM matter whose lead l1 is NOT a review row (no lead is listed at all).
  state.matters = [matter("m1", { lead_id: "l1" })];
  state.merged = false;
});

describe("loadReview({ withCustom }): the custom read covers the matters' leads (B1) and their merged duplicates (B2)", () => {
  it("(a) a TM matter whose lead is not a review row shows the lead's value, marked from the lead", async () => {
    state.db = db([valueOn("l1", "High")]).db;
    const r = await load({ withCustom: true });
    expect(r.custom?.status).toBe("ok");
    const row = r.rows.find((x) => x.id === "m1")!;
    const custom = r.custom!;
    if (custom.status !== "ok") throw new Error("ok expected");
    expect(custom.leadOfMatter).toEqual({ m1: "l1" });
    const hit = valueFor(row, custom.fields[0], custom);
    expect(hit).toMatchObject({ state: "value", fromLead: true });
    expect(hit.state === "value" && hit.value.choice).toBe("High");
    expect(r.failed).not.toContain("custom columns");
  });

  it("(b) the read is given the proposal lead ids (the matters' leads), not the review's lead ids", async () => {
    state.db = db([]).db;
    const customColumns = vi.fn(async () => ({ status: "ok" as const, fields: [], values: [], mergedInto: {} }));
    await load({ withCustom: true, reads: { customColumns } });
    expect(customColumns).toHaveBeenCalledTimes(1);
    const args = customColumns.mock.calls[0] as unknown[];
    expect(args[0]).toBe(state.db);
    expect(args[1]).toEqual(["m1"]);
    expect(args[2]).toEqual(["l1"]);
    expect(typeof args[3]).toBe("function");
  });

  it("(c) a lead merged into the matter's lead lends its value, marked from a merged duplicate", async () => {
    state.merged = true;
    state.db = db([valueOn("l9", "Low")], [{ id: "l9", merged_into_id: "l1" }]).db;
    const r = await load({ withCustom: true });
    const custom = r.custom!;
    if (custom.status !== "ok") throw new Error("ok expected");
    expect(custom.mergedInto).toEqual({ l9: "l1" });
    const hit = valueFor(r.rows.find((x) => x.id === "m1")!, custom.fields[0], custom);
    expect(hit).toMatchObject({ state: "value", fromMerged: true });
  });

  it("(d) a failed merged read names custom columns", async () => {
    state.merged = true;
    state.db = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : c.table === "crm_lead" ? { data: null, error: { code: "57014" } } : { data: [] })).db;
    const r = await load({ withCustom: true });
    expect(r.custom).toEqual({ status: "unavailable" });
    expect(r.failed).toContain("custom columns");
  });

  it("(e) withCustom false: the read is not called and custom is null", async () => {
    state.db = db([]).db;
    const customColumns = vi.fn(async () => ({ status: "ok" as const, fields: [], values: [], mergedInto: {} }));
    const r = await load({ withCustom: false, reads: { customColumns } });
    expect(customColumns).not.toHaveBeenCalled();
    expect(r.custom).toBeNull();
    expect(r.failed).not.toContain("custom columns");
    const none = await load(undefined);
    expect(none.custom).toBeNull();
  });

  it("not switched on is not a failure; anything else is named", async () => {
    state.db = fakeDb((c) => (c.table === "crm_custom_field" ? { data: null, error: { code: "PGRST205" } } : { data: [] })).db;
    const off = await load({ withCustom: true });
    expect(off.custom).toEqual({ status: "not-set-up" });
    expect(off.failed).not.toContain("custom columns");
    state.db = fakeDb((c) => (c.table === "crm_custom_field" ? { data: null, error: { code: "42501" } } : { data: [] })).db;
    const down = await load({ withCustom: true });
    expect(down.custom).toEqual({ status: "unavailable" });
    expect(down.failed).toContain("custom columns");
  });
});
