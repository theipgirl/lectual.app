/**
 * A recording stand-in for the service-role Supabase client: every chained
 * call is captured, and a handler decides what each query returns. Enough of
 * the PostgREST builder for src/lib/mailbox/{sync,apply}.ts — no more.
 */
export type Filter = { op: string; column: string; value: unknown };
export type Recorded = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  values?: unknown;
  filters: Filter[];
  columns?: string;
};

type Result = { data: unknown; error: { message: string; code?: string } | null };
export type Handler = (q: Recorded) => Result | undefined;

class Query implements PromiseLike<Result> {
  rec: Recorded;
  private isSingle = false;
  constructor(table: string, private handler: Handler, private log: Recorded[]) {
    this.rec = { table, action: "select", filters: [] };
  }
  select(columns?: string) {
    if (this.rec.action === "select") this.rec.columns = columns;
    return this;
  }
  insert(values: unknown) { this.rec.action = "insert"; this.rec.values = values; return this; }
  update(values: unknown) { this.rec.action = "update"; this.rec.values = values; return this; }
  delete() { this.rec.action = "delete"; return this; }
  eq(column: string, value: unknown) { this.rec.filters.push({ op: "eq", column, value }); return this; }
  in(column: string, value: unknown) { this.rec.filters.push({ op: "in", column, value }); return this; }
  not(column: string, _op: string, value: unknown) { this.rec.filters.push({ op: "not", column, value }); return this; }
  contains(column: string, value: unknown) { this.rec.filters.push({ op: "contains", column, value }); return this; }
  range() { return this; }
  order() { return this; }
  maybeSingle() { this.isSingle = true; return this; }
  single() { this.isSingle = true; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    this.log.push(this.rec);
    let res = this.handler(this.rec) ?? { data: this.rec.action === "select" ? [] : null, error: null };
    if (this.isSingle && Array.isArray(res.data)) res = { ...res, data: res.data[0] ?? null };
    return Promise.resolve(res).then(ok, bad);
  }
}

export function fakeAdmin(handler: Handler) {
  const log: Recorded[] = [];
  const client = { from: (table: string) => new Query(table, handler, log) };
  return { client, log };
}

export function filterValue(q: Recorded, column: string): unknown {
  return q.filters.find((f) => f.column === column)?.value;
}
