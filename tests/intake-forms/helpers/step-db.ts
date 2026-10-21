import { createHash, randomBytes } from "node:crypto";

/**
 * An in-memory stand-in for the SERVICE-ROLE client the public intake path
 * uses (src/lib/intake-forms/public.ts): no RLS, so what fences a write is
 * exactly the filters the code puts on it. Models only what the step code
 * asks of PostgREST: select (with an exact head count), insert, update, and
 * the eq / is / in / gte / order / limit / range filters. Every write is
 * recorded before any check, and an error can be injected per table and
 * operation, so degradation and refusals are asserted on rows and writes.
 */

export type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown; count?: number | null };
type Filter = (r: Row) => boolean;

export type DbWrite = { table: string; op: "insert" | "update"; payload: unknown };

export class AdminFake {
  tables: Record<string, Row[]>;
  writes: DbWrite[] = [];
  /** Reads of each table, in order (to assert a query was or wasn't made). */
  froms: string[] = [];
  private failures: { table: string; op: string; error: unknown; when?: (payload: unknown, eq: Record<string, unknown>) => boolean }[] = [];
  private seq = 0;

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** Make `op` on `table` fail with `error`; with `when`, only for a write whose payload matches. */
  fail(table: string, op: "select" | "insert" | "update", error: unknown, when?: (payload: unknown, eq: Record<string, unknown>) => boolean) {
    this.failures.push({ table, op, error, when });
  }

  failureFor(table: string, op: string, payload?: unknown, eq: Record<string, unknown> = {}) {
    return this.failures.find((f) => f.table === table && f.op === op && (!f.when || f.when(payload, eq)))?.error ?? null;
  }

  nextId() {
    return ++this.seq;
  }

  writesTo(table: string, op?: "insert" | "update") {
    return this.writes.filter((w) => w.table === table && (!op || w.op === op));
  }

  client() {
    return {
      from: (table: string) => {
        this.froms.push(table);
        return new Builder(this, table);
      },
    };
  }
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" = "select";
  private payload: unknown;
  private filters: Filter[] = [];
  private eqs: Record<string, unknown> = {};
  private head = false;
  private counted = false;
  private returning = false;
  private orders: Array<[string, boolean]> = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  constructor(
    private db: AdminFake,
    private table: string,
  ) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    void _columns;
    this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count) this.counted = true;
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
    this.db.writes.push({ table: this.table, op: "update", payload });
    return this;
  }
  eq(column: string, value: unknown) {
    this.eqs[column] = value;
    this.filters.push((r) => r[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  not(column: string, _op: string, value: null) {
    void _op;
    this.filters.push((r) => (r[column] ?? null) !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  gte(column: string, value: string | number) {
    this.filters.push((r) => r[column] !== null && r[column] !== undefined && (r[column] as string | number) >= value);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orders.push([column, opts?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    return this.run().then((r) => this.one(r, false));
  }
  single() {
    return this.run().then((r) => this.one(r, true));
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, bad);
  }

  private one(r: Result, required: boolean): Result {
    if (r.error || !Array.isArray(r.data)) return r;
    if (r.data.length === 1) return { data: r.data[0], error: null };
    if (r.data.length === 0 && !required) return { data: null, error: null };
    return { data: null, error: { code: "PGRST116", message: "no single row" } };
  }

  private async run(): Promise<Result> {
    const { db, table } = this;
    const failed = db.failureFor(table, this.op, this.payload, this.eqs);
    if (failed) return { data: null, error: failed };
    const matches = () => db.rows(table).filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "select") {
      let rows = matches();
      for (const [column, asc] of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = (a[column] ?? "") as string | number;
          const bv = (b[column] ?? "") as string | number;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      const total = rows.length;
      if (this.rangeFrom !== null && this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      if (this.head) return { data: null, error: null, count: this.counted ? total : undefined };
      return { data: rows.map((r) => ({ ...r })), error: null, count: this.counted ? total : undefined };
    }
    if (this.op === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const stored = incoming.map((raw) => {
        const row: Row = { id: table === "crm_intake_event" ? db.nextId() : `${table}-${db.nextId()}`, occurred_at: new Date().toISOString(), ...raw };
        db.rows(table).push(row);
        return { ...row };
      });
      return { data: this.returning ? stored : null, error: null };
    }
    const targets = matches();
    for (const row of targets) Object.assign(row, this.payload as Row);
    return { data: this.returning ? targets.map((r) => ({ ...r })) : null, error: null };
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

export const sha256Hex = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const FORM_A = "a1111111-1111-4111-8111-111111111111";
export const FORM_A2 = "a2222222-2222-4222-8222-222222222222";
export const FORM_B = "b1111111-1111-4111-8111-111111111111";

export function formRow(over: Row = {}): Row {
  return {
    id: FORM_A,
    org_id: ORG_A,
    name: "UGW 2026",
    slug: "ugw-2026",
    source_tag: "UGW 2026",
    kind: "intake",
    status: "live",
    config: {},
    allowed_domains: [],
    receives_referrals: false,
    ...over,
  };
}

export function personRow(token: string, over: Row = {}): Row {
  return {
    id: `person-${token.slice(0, 6)}`,
    org_id: ORG_A,
    form_id: FORM_A,
    resume_hash: sha256Hex(token),
    submitted_at: null,
    started_at: "2026-10-20T15:00:00Z",
    created_at: "2026-10-20T15:01:00Z",
    answers: [],
    progress: null,
    ...over,
  };
}
