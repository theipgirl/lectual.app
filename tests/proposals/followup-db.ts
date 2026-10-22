import type { FollowupDb } from "@/lib/proposals/accept-followups";

export type Row = Record<string, unknown>;
export type Call = { table: string; op: "select" | "insert"; filters: Array<[string, unknown]>; payload?: unknown };

/**
 * A fake service-role / scoped client for the acceptance follow-ups: tables of rows, `.eq`, `.in`
 * (including the `payload->>step` path), `.ilike` (case-insensitive equality, which is all the code
 * asks of it), `.limit`, `insert`, and a hook to make an insert fail or throw. Every call is recorded.
 */
export function fakeFollowupDb(
  tables: Record<string, Row[]>,
  opts: { failInsert?: (table: string, rows: Row[]) => "error" | "throw" | null; failSelect?: (table: string) => boolean } = {},
) {
  const calls: Call[] = [];
  let seq = 0;
  const value = (r: Row, col: string): unknown => {
    if (col.includes("->>")) {
      const [base, key] = col.split("->>");
      const obj = r[base];
      return obj && typeof obj === "object" ? (obj as Row)[key] : undefined;
    }
    return r[col];
  };
  const db: FollowupDb = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      let max = Infinity;
      const run = () => {
        calls.push(call);
        const rows = tables[table] ?? (tables[table] = []);
        if (call.op === "insert") {
          const list = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
          const fail = opts.failInsert?.(table, list);
          if (fail === "throw") throw new Error("insert exploded");
          if (fail === "error") return { data: null, error: { code: "XX000", message: "refused" } };
          for (const r of list) rows.push({ id: `${table}-${++seq}`, created_at: new Date(Date.UTC(2026, 9, 21, 15, 0, seq)).toISOString(), ...r });
          return { data: null, error: null };
        }
        if (opts.failSelect?.(table)) return { data: null, error: { code: "XX000", message: "refused" } };
        const matching = rows.filter((r) => call.filters.every(([c, v]) => matches(r, c, v)));
        return { data: matching.slice(0, max).map((r) => ({ ...r })), error: null };
      };
      const matches = (r: Row, c: string, v: unknown) => {
        if (c.startsWith("in:")) return (v as unknown[]).includes(value(r, c.slice(3)));
        if (c.startsWith("ilike:")) {
          const want = String(v).replace(/\\(.)/g, "$1").toLowerCase();
          const got = value(r, c.slice(6));
          return typeof got === "string" && got.toLowerCase() === want;
        }
        return value(r, c) === v;
      };
      const q: Record<string, unknown> = {
        select() {
          return q;
        },
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return q;
        },
        eq(column: string, v: unknown) {
          call.filters.push([column, v]);
          return q;
        },
        in(column: string, v: readonly unknown[]) {
          call.filters.push([`in:${column}`, v]);
          return q;
        },
        ilike(column: string, v: string) {
          call.filters.push([`ilike:${column}`, v]);
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          max = n;
          return q;
        },
        maybeSingle() {
          try {
            const r = run();
            return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
          } catch (e) {
            return Promise.reject(e);
          }
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          try {
            return Promise.resolve(run()).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      return q as never;
    },
  };
  return { db, calls, tables };
}
