/**
 * An in-memory stand-in for the caller's scoped Supabase client, used by the
 * Sprint 8 matter-editing tests. It is small on purpose and models exactly what
 * the matters code asks of PostgREST:
 *
 *  - RLS: a row whose org_id is not the session's org is invisible to every read
 *    and write, so "an id from another firm" behaves like an id that never
 *    existed (empty read), and an insert for another org is refused (42501).
 *  - A unique key on crm_matter_contact (matter, contact, role) -> 23505.
 *  - `.or()` / `.ilike()` with LIKE escapes and PostgREST double-quoted values, so
 *    "plain text" claims about the contact search are checked by behaviour.
 *  - Every attempted write is recorded in `writes` BEFORE any check, so a test
 *    can assert the client was never asked to write.
 *  - `rpc("current_org_role")` answers from a settable role, as in
 *    tests/matters/actions.test.ts.
 */

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: unknown };

export type Write = { table: string; op: "insert" | "update" | "delete"; payload?: unknown; ids?: string[] };

export type FakeDbOptions = {
  role?: string | null;
  orgId?: string;
  userId?: string;
  tables?: Record<string, Row[]>;
};

const UNIQUE: Record<string, string[]> = { crm_matter_contact: ["matter_id", "contact_id", "role"] };

/** Column defaults the database applies on insert. */
const DEFAULTS: Record<string, Row> = { crm_task: { status: "open", type: "custom" }, crm_matter_deadline: { status: "open" } };

function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
}

/** Splits a PostgREST `or=(...)` body on top-level commas, honouring double quotes and backslash escapes. */
function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quoted && ch === "\\" && i + 1 < expr.length) {
      current += ch + expr[++i];
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quoted) throw new Error(`unterminated quote in or(): ${expr}`);
  parts.push(current);
  return parts;
}

function orFilter(expr: string): Filter {
  const clauses = splitOr(expr).map((part) => {
    const [column, op, ...rest] = part.split(".");
    let value = rest.join(".");
    if (op !== "ilike") throw new Error(`fake db: unsupported or() operator ${op}`);
    if (value.startsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    return { column, regex: likeToRegex(value) };
  });
  return (row) => clauses.some((c) => typeof row[c.column] === "string" && c.regex.test(row[c.column] as string));
}

export class FakeDb {
  tables: Record<string, Row[]>;
  role: string | null;
  orgId: string;
  userId: string;
  writes: Write[] = [];
  /** Every `.or()` expression sent, in order. */
  orExpressions: string[] = [];
  /** Every `.order()` call: [table, column]. */
  orderCalls: Array<[string, string]> = [];
  rpcCalls: string[] = [];
  /** Tables whose deletes RLS silently filters down to zero rows (no error, nothing removed). */
  denyDeletes = new Set<string>();
  private seq = 0;
  private failures: Array<{ table: string; op: string; error: unknown }> = [];

  constructor(opts: FakeDbOptions = {}) {
    this.role = opts.role === undefined ? "attorney" : opts.role;
    this.orgId = opts.orgId ?? "org-1";
    this.userId = opts.userId ?? "user-1";
    this.tables = Object.fromEntries(Object.entries(opts.tables ?? {}).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  }

  /** Make the next (and every later) `op` ("select" | "insert" | "update" | "delete") on `table` fail. */
  fail(table: string, op: "select" | "insert" | "update" | "delete", error: unknown = { code: "XX000", message: "boom: internal detail" }) {
    this.failures.push({ table, op, error });
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** Activity rows written so far, oldest first. */
  activity(): Row[] {
    return this.rows("crm_activity");
  }

  nextId(table: string): string {
    return `${table}-gen-${++this.seq}`;
  }

  failureFor(table: string, op: string): unknown {
    return this.failures.find((f) => f.table === table && f.op === op)?.error ?? null;
  }

  visible(table: string): Row[] {
    return this.rows(table).filter((r) => r.org_id === undefined || r.org_id === this.orgId);
  }

  client() {
    return {
      from: (table: string) => new Builder(this, table),
      rpc: async (name: string): Promise<Result> => {
        this.rpcCalls.push(name);
        if (name === "current_org_role") return { data: this.role, error: null };
        if (name === "current_org_id") return { data: this.orgId, error: null };
        return { data: null, error: { message: `fake db: unknown rpc ${name}` } };
      },
      auth: { getUser: async () => ({ data: { user: { id: this.userId } }, error: null }) },
    };
  }
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: unknown;
  private filters: Filter[] = [];
  private orders: Array<[string, boolean]> = [];
  private limitN: number | null = null;
  private returning = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    this.returning = true;
    return this;
  }
  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    this.db.writes.push({ table: this.table, op: "insert", payload });
    return this;
  }
  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  ilike(column: string, pattern: string) {
    const regex = likeToRegex(pattern);
    this.filters.push((r) => typeof r[column] === "string" && regex.test(r[column] as string));
    return this;
  }
  or(expression: string) {
    this.db.orExpressions.push(expression);
    this.filters.push(orFilter(expression));
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.db.orderCalls.push([this.table, column]);
    this.orders.push([column, opts?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    return this.run().then((r) => this.one(r, true));
  }
  maybeSingle() {
    return this.run().then((r) => this.one(r, false));
  }
  then<A = Result, B = never>(onfulfilled?: ((v: Result) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(onfulfilled, onrejected);
  }

  private one(r: Result, required: boolean): Result {
    if (r.error || !Array.isArray(r.data)) return r;
    if (r.data.length === 1) return { data: r.data[0], error: null };
    if (r.data.length === 0 && !required) return { data: null, error: null };
    return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
  }

  private async run(): Promise<Result> {
    const { db, table } = this;
    const failed = db.failureFor(table, this.op);
    if (this.op === "update") db.writes.push({ table, op: "update", payload: this.payload });
    if (this.op === "delete") db.writes.push({ table, op: "delete" });
    if (failed) return { data: null, error: failed };

    const matches = () => db.visible(table).filter((r) => this.filters.every((f) => f(r)));

    if (this.op === "select") {
      let rows = matches();
      for (const [column, asc] of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = (a[column] ?? "") as string | number;
          const bv = (b[column] ?? "") as string | number;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return { data: rows.map((r) => ({ ...r })), error: null };
    }

    if (this.op === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const stored: Row[] = [];
      for (const raw of incoming) {
        if (raw.org_id !== undefined && raw.org_id !== db.orgId) {
          return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
        }
        const unique = UNIQUE[table];
        if (unique && db.rows(table).some((r) => unique.every((c) => r[c] === raw[c]))) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const row: Row = { id: db.nextId(table), created_at: new Date(Date.now() + db.rows(table).length).toISOString(), ...DEFAULTS[table], ...raw };
        db.rows(table).push(row);
        stored.push({ ...row });
      }
      return { data: this.returning ? stored : null, error: null };
    }

    const targets = matches();
    if (this.op === "update") {
      for (const row of targets) Object.assign(row, this.payload as Row);
      return { data: this.returning ? targets.map((r) => ({ ...r })) : null, error: null };
    }

    // delete
    if (db.denyDeletes.has(table)) return { data: this.returning ? [] : null, error: null };
    const removed = targets.map((r) => ({ ...r }));
    db.tables[table] = db.rows(table).filter((r) => !targets.includes(r));
    return { data: this.returning ? removed : null, error: null };
  }
}

export function createFakeDb(opts: FakeDbOptions = {}): FakeDb {
  return new FakeDb(opts);
}

/** Writes recorded against one table. */
export function writesTo(db: FakeDb, table: string): Write[] {
  return db.writes.filter((w) => w.table === table);
}
