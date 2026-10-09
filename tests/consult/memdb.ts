/**
 * A small in-memory stand-in for the Supabase query builder, for the consult
 * details tests. It understands what those code paths use — select, insert,
 * update, delete, eq, in, is, like, order, limit, single, maybeSingle — and the
 * one PostgREST feature the review's compare-and-set depends on: a JSON path in
 * a filter column (`notes->consult_details->>rev`). That feature was checked
 * against a real project (lectual-dev) while writing this; here it is only
 * mirrored so the tests can assert the write is conditional.
 *
 * Reads return copies, so a test cannot pass by mutating what the code under
 * test holds. `failTables` fails every statement against a table (the
 * "database unreachable" case); `beforeWrite` runs just before an insert or
 * update lands, which is where a test slips a competing write in.
 */

export type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "delete";
type Filter = { kind: "eq" | "in" | "is" | "like"; column: string; value: unknown };
export type LoggedQuery = { table: string; op: Op; filters: Filter[]; values?: unknown };

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function pathValue(row: Row, column: string): unknown {
  if (!column.includes("->")) return row[column];
  const parts = column.split(/->>|->/);
  const asText = column.includes("->>");
  let cur: unknown = row[parts[0]];
  for (const p of parts.slice(1)) {
    if (cur && typeof cur === "object") cur = (cur as Row)[p];
    else return null;
  }
  if (cur === undefined) return null;
  return asText && cur !== null ? String(cur) : cur;
}

export class MemDb {
  readonly log: LoggedQuery[] = [];
  failTables = new Set<string>();
  beforeWrite: ((table: string, op: Op) => void) | null = null;
  clock = "2026-10-09T12:00:00.000Z";
  rpcResults: Record<string, unknown> = { current_org_role: "attorney", current_org_id: "org-a" };
  private seq = 0;
  constructor(readonly tables: Record<string, Row[]>) {}

  auth = { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) };
  from(table: string) {
    return new Query(this, table);
  }
  async rpc(name: string) {
    return { data: this.rpcResults[name] ?? null, error: null };
  }
  nextId(table: string) {
    this.seq += 1;
    return `${table}-${this.seq}`;
  }
  writes(table: string, op?: Op) {
    return this.log.filter((q) => q.table === table && q.op !== "select" && (!op || q.op === op));
  }
}

class Query implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
  private op: Op = "select";
  private cols: string[] | null = null;
  private wantsRows = false;
  private filters: Filter[] = [];
  private patch: Row = {};
  private inserts: Row[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(
    private db: MemDb,
    private table: string,
  ) {}

  select(columns?: string) {
    this.wantsRows = true;
    this.cols = !columns || columns.trim() === "*" ? null : columns.split(",").map((c) => c.trim());
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.inserts = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
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
  in(column: string, value: readonly unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  like(column: string, value: string) {
    this.filters.push({ kind: "like", column, value });
    return this;
  }
  order(column: string, o?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: o?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A, B = never>(
    ok?: ((v: { data: unknown; error: { code?: string; message: string } | null }) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null,
  ) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const cell = pathValue(row, f.column);
      switch (f.kind) {
        case "eq":
          return cell === f.value;
        case "in":
          return (f.value as readonly unknown[]).includes(cell);
        case "is":
          return cell === null || cell === undefined;
        case "like": {
          const re = new RegExp(`^${String(f.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
          return typeof cell === "string" && re.test(cell);
        }
      }
    });
  }

  private project(row: Row): Row {
    if (!this.cols) return clone(row);
    const out: Row = {};
    for (const c of this.cols) out[c] = clone(row[c]);
    return out;
  }

  private finish(rows: Row[]) {
    const projected = rows.map((r) => this.project(r));
    if (this.mode === "many") return { data: projected, error: null };
    if (this.mode === "maybe") return { data: projected[0] ?? null, error: null };
    return projected[0] ? { data: projected[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
  }

  private run() {
    this.db.log.push({ table: this.table, op: this.op, filters: this.filters, values: this.op === "insert" ? clone(this.inserts) : this.op === "update" ? clone(this.patch) : undefined });
    if (this.db.failTables.has(this.table)) return { data: null, error: { code: "08006", message: "connection failure" } };
    const rows = (this.db.tables[this.table] ??= []);
    if (this.op === "insert") {
      this.db.beforeWrite?.(this.table, "insert");
      const added = this.inserts.map((r) => ({ id: this.db.nextId(this.table), created_at: this.db.clock, ...clone(r) }));
      rows.push(...added);
      return this.wantsRows ? this.finish(added) : { data: null, error: null };
    }
    if (this.op === "update") {
      this.db.beforeWrite?.(this.table, "update");
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, clone(this.patch));
      return this.wantsRows ? this.finish(hit) : { data: null, error: null };
    }
    if (this.op === "delete") {
      const hit = rows.filter((r) => this.matches(r));
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return this.wantsRows ? this.finish(hit) : { data: null, error: null };
    }
    let result = rows.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => String(pathValue(a, column) ?? "").localeCompare(String(pathValue(b, column) ?? "")) * (ascending ? 1 : -1));
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN);
    return this.finish(result);
  }
}
