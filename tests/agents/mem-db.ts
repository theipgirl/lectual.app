import type { Handler, Recorded } from "../mailbox/fake-db";

/**
 * A small in-memory table store behind the recording fake admin: selects honour the recorded filters
 * (eq / in / gt / gte / lt / lte / neq / not-null / is-null / contains, including `payload->>key`
 * paths), order and limit; inserts append rows; updates and deletes apply to the rows the filters
 * match. It lets an agent test say "two firms' rows are in here" and "run it twice" and mean it.
 *
 * `failures` makes a statement fail on demand: a function that returns a Postgres-shaped error for a
 * recorded statement (or undefined to let it through).
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export type DbError = { message: string; code?: string };

export type MemDb = {
  tables: Tables;
  handler: Handler;
  /** Statements that were answered with an error, for assertions. */
  failed: Recorded[];
};

function valueAt(row: Row, column: string): unknown {
  if (column.includes("->>")) {
    const [base, key] = column.split("->>");
    const root = row[base];
    return root && typeof root === "object" ? (root as Row)[key] : undefined;
  }
  return row[column];
}

const asComparable = (v: unknown): string | number => (typeof v === "number" ? v : String(v));

function matches(row: Row, f: Recorded["filters"][number]): boolean {
  const v = valueAt(row, f.column);
  switch (f.op) {
    case "eq":
      return String(v) === String(f.value) || v === f.value;
    case "neq":
      return String(v) !== String(f.value);
    case "in":
      return (f.value as unknown[]).some((x) => String(x) === String(v));
    case "gte":
      return v != null && asComparable(v) >= asComparable(f.value);
    case "gt":
      return v != null && asComparable(v) > asComparable(f.value);
    case "lte":
      return v != null && asComparable(v) <= asComparable(f.value);
    case "lt":
      return v != null && asComparable(v) < asComparable(f.value);
    case "not":
      return f.value === null ? v != null : String(v) !== String(f.value);
    case "is":
      return f.value === null ? v == null : v === f.value;
    case "contains":
      return Array.isArray(v) && (f.value as unknown[]).every((x) => v.includes(x));
    default:
      return true;
  }
}

export function memDb(initial: Tables, opts: { failures?: (q: Recorded) => DbError | undefined } = {}): MemDb {
  const tables: Tables = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const failed: Recorded[] = [];
  let seq = 0;

  const handler: Handler = (q) => {
    const err = opts.failures?.(q);
    if (err) {
      failed.push(q);
      return { data: null, error: err };
    }
    const rows = (tables[q.table] ??= []);
    if (q.action === "insert") {
      const values = (Array.isArray(q.values) ? q.values : [q.values]) as Row[];
      const added = values.map((v) => ({ id: `${q.table}-${(seq += 1)}`, created_at: new Date(0).toISOString(), ...v }));
      rows.push(...added);
      return { data: added, error: null };
    }
    const hit = rows.filter((r) => q.filters.every((f) => matches(r, f)));
    if (q.action === "update") {
      for (const r of hit) Object.assign(r, q.values as Row);
      return { data: hit, error: null };
    }
    if (q.action === "delete") {
      tables[q.table] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    }
    let out = hit;
    if (q.order) {
      const { column, ascending } = q.order;
      out = [...out].sort((a, b) => {
        const x = asComparable(valueAt(a, column) ?? "");
        const y = asComparable(valueAt(b, column) ?? "");
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (typeof q.limit === "number") out = out.slice(0, q.limit);
    return { data: out, error: null };
  };
  return { tables, handler, failed };
}
