import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CUSTOM_CHUNK, CUSTOM_MAX_PAGES, CUSTOM_PAGE, FIELD_SELECT, VALUE_SELECT, VALUE_SELECT_NO_MONEY, loadCustomColumns } from "@/lib/custom-columns/load";

/** A recording fake of the scoped client (the fees-load recorder, plus `limit`). */
type Call = { table: string; select: string; eq: [string, unknown][]; is: [string, null][]; inn: [string, readonly string[]][]; order: string[]; range: [number, number] | null; limit: number | null };
type Ans = { data: unknown; error?: unknown };
function fakeDb(answer: (call: Call) => Ans) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call: Call = { table, select, eq: [], is: [], inn: [], order: [], range: null, limit: null };
          const b: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (call.eq.push([c, v]), b),
            is: (c: string, v: null) => (call.is.push([c, v]), b),
            in: (c: string, v: readonly string[]) => (call.inn.push([c, v]), b),
            order: (c: string) => (call.order.push(c), b),
            range: (from: number, to: number) => ((call.range = [from, to]), b),
            limit: (n: number) => ((call.limit = n), b),
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(call);
              const r = answer(call);
              return resolve({ data: r.data, error: r.error ?? null });
            },
          };
          return b;
        },
      };
    },
  };
  return { db, calls };
}

const FIELD = "00000000-0000-4000-8000-00000000f001";
const fieldRow = { id: FIELD, section: "trademarks", label: "Priority", kind: "choice", options: ["High", "Low"], position: 0 };
const valueRow = (over: Record<string, unknown> = {}) => ({ id: "v1", field_id: FIELD, lead_id: "l-1", matter_id: null, value_text: null, value_date: null, value_cents: null, value_choice: "High", value_user_id: null, updated_at: "2026-11-01T00:00:00Z", ...over });
const noMerged = vi.fn(async () => new Map<string, string>());
/** The owner's read: amounts included (the existing cases). */
const OWNER = { canSeeMoney: true };
const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("loadCustomColumns: three states", () => {
  it("42P01 or PGRST205 on the field read is not-set-up; so is 42P01 on the value read only", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const { db } = fakeDb(() => ({ data: null, error: { code, message: "relation does not exist" } }));
      expect(await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER)).toEqual({ status: "not-set-up" });
    }
    const { db } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : { data: null, error: { code: "42P01" } }));
    expect(await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER)).toEqual({ status: "not-set-up" });
  });

  it("42501, a network error object, data null or a non-array answer is unavailable", async () => {
    for (const ans of [{ data: null, error: { code: "42501" } }, { data: null, error: new Error("fetch failed") }, { data: null }, { data: { rows: [] } }]) {
      const { db } = fakeDb(() => ans);
      expect(await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER), JSON.stringify(ans)).toEqual({ status: "unavailable" });
    }
    // the same on the value read only
    for (const ans of [{ data: null, error: { code: "42501" } }, { data: null }, { data: "x" }]) {
      const { db } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : ans));
      expect(await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER)).toEqual({ status: "unavailable" });
    }
  });

  it("a rejecting merged-leads read is unavailable", async () => {
    const { db } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : { data: [] }));
    expect(await loadCustomColumns(db, [], ["l1"], async () => { throw new Error("merged read failed"); }, OWNER)).toEqual({ status: "unavailable" });
  });

  it("zero live fields is ok, and neither the merged read nor the value table is called", async () => {
    const { db, calls } = fakeDb(() => ({ data: [] }));
    const merged = vi.fn(async () => new Map<string, string>());
    expect(await loadCustomColumns(db, ["m1"], ["l1"], merged, OWNER)).toEqual({ status: "ok", fields: [], values: [], mergedInto: {} });
    expect(merged).not.toHaveBeenCalled();
    expect(calls.map((c) => c.table)).toEqual(["crm_custom_field"]);
  });
});

describe("loadCustomColumns: the reads", () => {
  it("the field read: archived = false, ordered position then label, named columns, bounded", async () => {
    const { db, calls } = fakeDb(() => ({ data: [] }));
    await loadCustomColumns(db, [], [], noMerged, OWNER);
    expect(calls[0]).toMatchObject({ table: "crm_custom_field", select: FIELD_SELECT, eq: [["archived", false]] });
    expect(calls[0].order.slice(0, 2)).toEqual(["position", "label"]);
    expect(calls[0].limit).toBeGreaterThan(40);
  });

  it("170 matter ids and 90 lead ids read in 3 and 2 chunks of at most 80; merged children join the lead chunks", async () => {
    const { db, calls } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : { data: [] }));
    const merged = vi.fn(async () => new Map([["child-1", "l0"]]));
    const r = await loadCustomColumns(db, ids(170, "m"), ids(90, "l"), merged, OWNER);
    expect(r.status).toBe("ok");
    expect(merged).toHaveBeenCalledTimes(1);
    expect((merged.mock.calls[0] as unknown[])[0]).toBe(db);
    expect((merged.mock.calls[0] as unknown[])[1]).toEqual(ids(90, "l"));
    const byMatter = calls.filter((c) => c.inn[0]?.[0] === "matter_id");
    const byLead = calls.filter((c) => c.inn[0]?.[0] === "lead_id");
    expect(byMatter).toHaveLength(3);
    expect(byLead).toHaveLength(2);
    for (const c of [...byMatter, ...byLead]) expect(c.inn[0][1].length).toBeLessThanOrEqual(CUSTOM_CHUNK);
    expect(byLead.flatMap((c) => c.inn[0][1])).toContain("child-1");
    expect(byLead.flatMap((c) => c.inn[0][1])).toHaveLength(91);
    expect(r.status === "ok" && r.mergedInto).toEqual({ "child-1": "l0" });
  });

  it("every select names its columns: no `*` anywhere", async () => {
    const { db, calls } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : { data: [] }));
    await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER);
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c.select).not.toContain("*");
    expect(calls.filter((c) => c.table === "crm_custom_value").every((c) => c.select === VALUE_SELECT)).toBe(true);
  });

  it("a page of exactly 1,000 rows reads the next page", async () => {
    const full = Array.from({ length: CUSTOM_PAGE }, (_, i) => valueRow({ id: `v${i}` }));
    const { db, calls } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : c.range?.[0] === 0 ? { data: full } : { data: [valueRow({ id: "last" })] }));
    const r = await loadCustomColumns(db, [], ["l1"], noMerged, OWNER);
    expect(calls.filter((c) => c.table === "crm_custom_value").map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(r.status === "ok" && r.values.length).toBe(CUSTOM_PAGE + 1);
  });

  it("10 full pages run out the budget: unavailable, never what it had", async () => {
    const full = Array.from({ length: CUSTOM_PAGE }, (_, i) => valueRow({ id: `v${i}` }));
    const { db, calls } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : { data: full }));
    expect(await loadCustomColumns(db, [], ["l1"], noMerged, OWNER)).toEqual({ status: "unavailable" });
    expect(calls.filter((c) => c.table === "crm_custom_value")).toHaveLength(CUSTOM_MAX_PAGES);
  });

  it("an error on page 2 of one chunk is unavailable, with no partial rows", async () => {
    const full = Array.from({ length: CUSTOM_PAGE }, (_, i) => valueRow({ id: `v${i}` }));
    const { db } = fakeDb((c) => (c.table === "crm_custom_field" ? { data: [fieldRow] } : c.range?.[0] === 0 ? { data: full } : { data: null, error: { code: "57014" } }));
    expect(await loadCustomColumns(db, [], ["l1"], noMerged, OWNER)).toEqual({ status: "unavailable" });
  });

  it("malformed field rows, malformed values, both-owner rows and unknown field ids are dropped", async () => {
    const other = "00000000-0000-4000-8000-00000000f0ff";
    const { db } = fakeDb((c) =>
      c.table === "crm_custom_field"
        ? { data: [fieldRow, { ...fieldRow, id: "bad", label: "" }] }
        : { data: [valueRow(), valueRow({ id: "both", matter_id: "m1" }), valueRow({ id: "unknown", field_id: other }), valueRow({ id: "two", value_text: "x" }), { nope: true }] },
    );
    const r = await loadCustomColumns(db, [], ["l1"], noMerged, OWNER);
    expect(r.status === "ok" && r.fields.map((f) => f.id)).toEqual([FIELD]);
    expect(r.status === "ok" && r.values.map((v) => v.id)).toEqual(["v1"]);
  });
});

describe("loadCustomColumns: Money is owner-only (Taylor, Nov 23)", () => {
  const MONEY = "00000000-0000-4000-8000-00000000f002";
  const moneyRow = { id: MONEY, section: "both", label: "Quoted fee", kind: "money", options: [], position: 1 };
  const answer = (c: Call): Ans =>
    c.table === "crm_custom_field"
      ? { data: [fieldRow, moneyRow] }
      : // A database that (wrongly) still returned an amount: the loader must drop it for a non-owner anyway.
        { data: [valueRow(), valueRow({ id: "amt", field_id: MONEY, value_choice: null, value_cents: 125000 })] };

  it("a non-owner's value read never names value_cents and asks only for rows whose amount is null; Money fields and amounts are dropped", async () => {
    const { db, calls } = fakeDb(answer);
    const r = await loadCustomColumns(db, ["m1"], ["l1"], noMerged, { canSeeMoney: false });
    const valueCalls = calls.filter((c) => c.table === "crm_custom_value");
    expect(valueCalls.length).toBeGreaterThan(0);
    for (const c of valueCalls) {
      expect(c.select).toBe(VALUE_SELECT_NO_MONEY);
      expect(c.select).not.toContain("value_cents");
      expect(c.is).toEqual([["value_cents", null]]);
    }
    expect(r.status === "ok" && r.fields.map((f) => f.id)).toEqual([FIELD]);
    expect(r.status === "ok" && r.values.map((v) => v.id)).toEqual(["v1"]);
    expect(r.status === "ok" && r.values.every((v) => v.cents === null)).toBe(true);
  });

  it("the owner's read names value_cents, adds no filter, and keeps the Money field and its amount", async () => {
    const { db, calls } = fakeDb(answer);
    const r = await loadCustomColumns(db, ["m1"], ["l1"], noMerged, OWNER);
    for (const c of calls.filter((x) => x.table === "crm_custom_value")) {
      expect(c.select).toBe(VALUE_SELECT);
      expect(c.is).toEqual([]);
    }
    expect(r.status === "ok" && r.fields.map((f) => f.id)).toEqual([FIELD, MONEY]);
    expect(r.status === "ok" && r.values.find((v) => v.id === "amt")?.cents).toBe(125000);
  });

  it("a missing or malformed access object reads as no money (fails closed)", async () => {
    const { db, calls } = fakeDb(answer);
    const r = await loadCustomColumns(db, ["m1"], ["l1"], noMerged, undefined as never);
    expect(r.status === "ok" && r.fields.map((f) => f.kind)).toEqual(["choice"]);
    for (const c of calls.filter((x) => x.table === "crm_custom_value")) expect(c.select).toBe(VALUE_SELECT_NO_MONEY);
  });
});

describe("source guard", () => {
  it("no admin client, no service role, server-only", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/lib/custom-columns/load.ts"), "utf8");
    expect(src).not.toMatch(/@\/lib\/db\/admin/);
    expect(src).not.toMatch(/SERVICE_ROLE/);
    expect(src).not.toMatch(/@\/lib\/db\/scoped-client/);
    expect(src).toMatch(/^import "server-only";/);
  });
});
