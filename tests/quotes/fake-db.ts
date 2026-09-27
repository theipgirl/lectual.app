import type { PublicDbQuery, PublicDbResult, PublicQuotesDb } from "@/lib/quotes/public";

/**
 * A small fake of PostgREST for the `/q/[token]` path's service-role client —
 * shared by public.test.ts and accept-matter.test.ts.
 *
 * `.eq/.in/.is/.or/.order/.limit`, projection by the requested column list, and
 * set-based updates and deletes that return the rows they actually changed.
 * That last part is the one that matters: the acceptance guard (and the matter
 * link) is a WHERE clause, and "how many rows came back" is the signal it turns
 * on. A fake that always returned the row would pass a broken implementation,
 * so it does not.
 *
 * `unique` stands in for a unique index: an insert that would duplicate one is
 * refused with 23505, the way `(org_id, matter_number)` refuses a second matter
 * numbered the same.
 *
 * What this cannot test, and what covers it instead: that Postgres evaluates
 * the same predicate under real concurrency (row locks), and that RLS is
 * configured as 0068 writes it. Those live in lectual's
 * `tests/tenant-isolation.test.ts` against a real database.
 */

export type Row = Record<string, unknown>;

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: readonly unknown[] }
  | { kind: "is"; column: string; value: null }
  | { kind: "or"; expr: string };

type Tables = Record<string, Row[]>;

export class FakeDb implements PublicQuotesDb {
  readonly tables: Tables;
  /** Every select string this route asked for, so a test can assert the
   * allowlist is what actually went over the wire — not merely what a constant
   * says. */
  readonly selects: { table: string; columns: string }[] = [];
  /** Every write, in order, for tests that assert what was (not) written. */
  readonly writes: { table: string; op: "insert" | "update" | "delete"; filters: Filter[] }[] = [];
  readonly queryCount: { value: number } = { value: 0 };
  /** Lets a test hold a query open (the race barrier). */
  beforeQuery: ((table: string, op: string) => Promise<void>) | null = null;
  /** Forces every query against a table to fail, for the unavailable path. */
  failTable: string | null = null;
  /** Fails INSERTs into one table only (reads still work). */
  failInsertTable: string | null = null;
  /** Fails the next INSERT into a table with this PostgREST code, once. */
  insertFailure: { table: string; code: string } | null = null;
  /** Unique indexes: table → column lists. */
  unique: Record<string, string[][]> = {};
  /** Stands in for `created_at timestamptz not null default now()`. Settable so
   * a test can advance time deliberately rather than depend on how fast the
   * suite runs. */
  clock = "2026-09-09T15:00:00.000Z";

  constructor(tables: Tables) {
    this.tables = tables;
  }

  from(table: string): PublicDbQuery {
    return new FakeQuery(this, table) as unknown as PublicDbQuery;
  }
}

class FakeQuery {
  private op: "select" | "update" | "insert" | "delete" = "select";
  private columns: string[] | null = null;
  private patch: Row = {};
  private inserts: Row[] = [];
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(columns: string) {
    this.columns = columns.split(",").map((c) => c.trim());
    this.db.selects.push({ table: this.table, columns });
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.inserts = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  or(expr: string) {
    this.filters.push({ kind: "or", expr });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(count: number) {
    this.limitN = count;
    return this;
  }
  maybeSingle() {
    this.singleMode = true;
    return this;
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: PublicDbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<PublicDbResult> {
    this.db.queryCount.value += 1;
    if (this.db.beforeQuery) await this.db.beforeQuery(this.table, this.op);
    if (this.db.failTable === this.table) {
      return { data: null, error: { code: "08006", message: "connection failure" } };
    }

    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    if (this.op !== "select") this.db.writes.push({ table: this.table, op: this.op, filters: this.filters });

    if (this.op === "insert") {
      if (this.db.failInsertTable === this.table) {
        return { data: null, error: { code: "08006", message: "connection failure" } };
      }
      const failure = this.db.insertFailure;
      if (failure && failure.table === this.table) {
        this.db.insertFailure = null;
        return { data: null, error: { code: failure.code, message: "insert refused" } };
      }
      for (const keys of this.db.unique[this.table] ?? []) {
        for (const row of this.inserts) {
          if (rows.some((existing) => keys.every((k) => existing[k] === row[k]))) {
            return { data: null, error: { code: "23505", message: "duplicate key value" } };
          }
        }
      }
      const added: Row[] = [];
      for (const row of this.inserts) {
        const stored = { id: `gen-${this.table}-${rows.length + 1}`, created_at: this.db.clock, ...row };
        rows.push(stored);
        added.push(stored);
      }
      return { data: this.columns ? added.map((row) => this.project(row)) : null, error: null };
    }

    const matched = rows.filter((row) => this.matches(row));

    if (this.op === "update") {
      for (const row of matched) Object.assign(row, this.patch);
      return { data: matched.map((row) => this.project(row)), error: null };
    }

    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((row) => !matched.includes(row));
      return { data: matched.map((row) => this.project(row)), error: null };
    }

    let result = matched;
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN);
    const projected = result.map((row) => this.project(row));
    return this.singleMode ? { data: projected[0] ?? null, error: null } : { data: projected, error: null };
  }

  /** Projection is the point of the fake: a column the route did not ask for
   * must not come back, so a test asserting "no org_id in the payload" is
   * asserting something real. */
  private project(row: Row): Row {
    if (!this.columns) return { ...row };
    const out: Row = {};
    for (const column of this.columns) out[column] = row[column];
    return out;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      switch (filter.kind) {
        case "eq":
          return row[filter.column] === filter.value;
        case "in":
          return filter.values.includes(row[filter.column]);
        case "is":
          return row[filter.column] === null || row[filter.column] === undefined;
        case "or":
          return filter.expr.split(",").some((term) => this.matchesTerm(row, term));
      }
    });
  }

  /** PostgREST splits a filter term on its FIRST TWO dots only — which is what
   * makes `expires_at.gt.2026-09-09T12:00:00.000Z` (three more dots in the
   * value) a legal filter and not a parse error. Mirrored here so the fake
   * agrees with the thing it is standing in for. */
  private matchesTerm(row: Row, term: string): boolean {
    const firstDot = term.indexOf(".");
    const secondDot = term.indexOf(".", firstDot + 1);
    if (firstDot < 0 || secondDot < 0) return false;
    const column = term.slice(0, firstDot);
    const operator = term.slice(firstDot + 1, secondDot);
    const value = term.slice(secondDot + 1);
    const cell = row[column];
    if (operator === "is") return value === "null" ? cell === null || cell === undefined : false;
    if (operator === "gt") return typeof cell === "string" && cell > value;
    if (operator === "gte") return typeof cell === "string" && cell >= value;
    return false;
  }
}
