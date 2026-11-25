import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readViewLayout } from "@/lib/views/layout/load";
import { layoutNote, savedLayoutOf } from "@/lib/views/layout/state";
import { VIEW_LAYOUT_UNAVAILABLE } from "@/lib/ui/words";

/** A recording fake of the scoped client: one table, one select, one eq, maybeSingle. */
function fakeDb(answer: { data?: unknown; error?: unknown } | (() => never)) {
  const calls: { table: string; select: string; eq: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call = { table, select, eq: [] as [string, unknown][] };
          calls.push(call);
          const b = {
            eq: (c: string, v: unknown) => (call.eq.push([c, v]), b),
            maybeSingle: async () => {
              if (typeof answer === "function") return answer();
              return { data: answer.data ?? null, error: answer.error ?? null };
            },
          };
          return b;
        },
      };
    },
  };
  return { db, calls };
}
const col = (key: string, over: object = {}) => ({ key, label: null, hidden: false, width: null, ...over });

describe("readViewLayout: three states", () => {
  it("ok with a row: the layout and its rev; the read names its columns and asks for that view only", async () => {
    const { db, calls } = fakeDb({ data: { columns: [col("client"), col("status", { label: "Stage" })], rev: 3 } });
    expect(await readViewLayout(db, "review_list_trademarks")).toEqual({ status: "ok", layout: [col("client"), col("status", { label: "Stage" })], rev: 3 });
    expect(calls).toEqual([{ table: "crm_view_layout", select: "columns, rev", eq: [["view_key", "review_list_trademarks"]] }]);
  });

  it("ok with no row: no layout (the standard columns), no rev", async () => {
    expect(await readViewLayout(fakeDb({ data: null }).db, "review_board")).toEqual({ status: "ok", layout: null, rev: null });
  });

  it("not-set-up on the table's or a column's missing code (42P01, PGRST205, 42703), never on message text", async () => {
    for (const code of ["42P01", "PGRST205", "42703"]) {
      expect(await readViewLayout(fakeDb({ error: { code, message: "boom" } }).db, "review_list_trademarks"), code).toEqual({ status: "not-set-up" });
    }
    expect(await readViewLayout(fakeDb({ error: { code: "XX000", message: 'relation "crm_view_layout" does not exist' } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ error: { message: "relation does not exist" } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
  });

  it("unavailable: any other error, a throw, an answer that isn't a row, a layout the database could not have stored, a bad rev", async () => {
    expect(await readViewLayout(fakeDb({ error: { code: "57014" } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb(() => { throw new Error("network"); }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: [] }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: "x" }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: { columns: [], rev: 1 } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: { columns: [col("Bad Key")], rev: 1 } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: { columns: [col("client"), col("client")], rev: 1 } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: { columns: [col("client")], rev: 0 } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
    expect(await readViewLayout(fakeDb({ data: { columns: [col("client")] } }).db, "review_list_trademarks")).toEqual({ status: "unavailable" });
  });
});

describe("what the page does with a read", () => {
  it("only an ok read with a row applies a layout; every other state draws the standard columns", () => {
    const layout = [col("client")];
    expect(savedLayoutOf({ status: "ok", layout, rev: 1 })).toBe(layout);
    for (const r of [{ status: "ok", layout: null, rev: null }, { status: "not-set-up" }, { status: "unavailable" }, null, undefined] as const) expect(savedLayoutOf(r as never)).toBeNull();
  });

  it("one quiet sentence for a failed read only: not-set-up and ok say nothing", () => {
    expect(layoutNote({ status: "unavailable" })).toBe(VIEW_LAYOUT_UNAVAILABLE);
    expect(VIEW_LAYOUT_UNAVAILABLE).toBe("Saved column layout couldn't load. Showing the standard columns. Refresh to try again.");
    for (const r of [{ status: "ok", layout: null, rev: null }, { status: "not-set-up" }, null, undefined] as const) expect(layoutNote(r as never)).toBeNull();
  });
});

describe("the reader's source", () => {
  const src = readFileSync("src/lib/views/layout/load.ts", "utf8");
  it("uses the scoped client only: no service role, no write", () => {
    expect(src).toMatch(/getScopedClient/);
    expect(src).not.toMatch(/db\/admin|getAdminClient|SERVICE_ROLE/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
