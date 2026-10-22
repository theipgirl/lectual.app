/**
 * A recording stand-in for the signed-in scoped Supabase client, enough of the builder for the saved-chat
 * store. The handler may be async (a test can hold a statement open) and decides what each statement returns.
 */
export type Stmt = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  values?: Record<string, unknown>;
  filters: Array<{ op: string; column: string; value: unknown }>;
  order: Array<{ column: string; ascending: boolean }>;
  limit?: number;
  columns?: string;
  single?: boolean;
};
export type Reply = { data: unknown; error: { message?: string; code?: string } | null };
export type StmtHandler = (s: Stmt) => Reply | undefined | Promise<Reply | undefined>;

class Query implements PromiseLike<Reply> {
  s: Stmt;
  constructor(table: string, private handler: StmtHandler, private log: Stmt[]) {
    this.s = { table, action: "select", filters: [], order: [] };
  }
  select(columns?: string) {
    if (this.s.action === "select") this.s.columns = columns;
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.s.action = "insert";
    this.s.values = values;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.s.action = "update";
    this.s.values = values;
    return this;
  }
  delete() {
    this.s.action = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.s.filters.push({ op: "eq", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.s.order.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.s.limit = n;
    return this;
  }
  maybeSingle() {
    this.s.single = true;
    return this;
  }
  single() {
    this.s.single = true;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<A = Reply, B = never>(ok?: ((v: Reply) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    this.log.push(this.s);
    return (async () => {
      let res = (await this.handler(this.s)) ?? { data: this.s.action === "select" ? [] : null, error: null };
      if (this.s.single && Array.isArray(res.data)) res = { ...res, data: res.data[0] ?? null };
      return res;
    })().then(ok, bad);
  }
}

export function fakeScoped(handler: StmtHandler) {
  const log: Stmt[] = [];
  const client = { from: (table: string) => new Query(table, handler, log) };
  return { client, log };
}

/** A handler for a healthy 0099 database: conversations by id, an id for each new chat, every write succeeding. */
export function healthyDb(opts: { existing?: Record<string, { id: string; title: string; updated_at: string }>; messages?: Record<string, unknown[]> } = {}): StmtHandler {
  let n = 0;
  return (s) => {
    if (s.table === "copilot_conversation") {
      if (s.action === "insert") return { data: [{ id: `conv-new-${(n += 1)}` }], error: null };
      if (s.action === "select") {
        const id = s.filters.find((f) => f.column === "id")?.value as string | undefined;
        return { data: id ? (opts.existing?.[id] ? [opts.existing[id]] : []) : Object.values(opts.existing ?? {}), error: null };
      }
      if (s.action === "delete") return { data: [{ id: s.filters.find((f) => f.column === "id")?.value }], error: null };
    }
    if (s.table === "copilot_message" && s.action === "select") {
      const id = s.filters.find((f) => f.column === "conversation_id")?.value as string;
      return { data: opts.messages?.[id] ?? [], error: null };
    }
    return undefined;
  };
}
