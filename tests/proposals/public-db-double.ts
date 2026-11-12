import type { PublicProposalsDb } from "@/lib/proposals/public";

export type Row = Record<string, unknown>;
export type Call = { table: string; op: "select" | "update" | "insert"; filters: Array<[string, unknown]>; payload?: unknown; columns?: string };
export type RpcCall = { fn: string; args: Record<string, unknown> };

/**
 * Just enough of PostgREST's builder to drive the public path: tables of rows, `.eq` filters ANDed together, `update` that only
 * touches matching rows (the conditional-update fence), `insert`, `order`, `limit`, and an `rpc` spy whose behaviour a test
 * supplies (`rpcImpl`), so the 0106 sign-and-accept function can be played as the database would.
 */
export function fakeDb(
  tables: Record<string, Row[]>,
  opts: { rpcImpl?: (fn: string, args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: { code?: string; message?: string } | null }; noRpc?: boolean } = {},
) {
  const calls: Call[] = [];
  const rpcCalls: RpcCall[] = [];
  const db: PublicProposalsDb = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      let orderBy: { column: string; ascending: boolean } | null = null;
      let max = Infinity;
      let selectAfterUpdate = false;
      const run = () => {
        calls.push(call);
        const rows = tables[table] ?? (tables[table] = []);
        const matching = rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
        if (call.op === "insert") {
          rows.push({ ...(call.payload as Row), created_at: new Date().toISOString() });
          return { data: null, error: null };
        }
        if (call.op === "update") {
          for (const r of matching) Object.assign(r, call.payload);
          return { data: selectAfterUpdate ? matching.map((r) => ({ ...r })) : null, error: null };
        }
        let out = matching.map((r) => ({ ...r }));
        if (orderBy) {
          const { column, ascending } = orderBy;
          out = out.sort((a, b) => ((a[column] as number | string) > (b[column] as number | string) ? 1 : -1) * (ascending ? 1 : -1));
        }
        return { data: out.slice(0, max), error: null };
      };
      const q: Record<string, unknown> = {
        select(columns: string) {
          if (call.op === "update") selectAfterUpdate = true;
          else call.columns = columns;
          return q;
        },
        update(patch: Row) {
          call.op = "update";
          call.payload = patch;
          return q;
        },
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return q;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return q;
        },
        order(column: string, o?: { ascending?: boolean }) {
          orderBy = { column, ascending: o?.ascending ?? true };
          return q;
        },
        limit(n: number) {
          max = n;
          return q;
        },
        maybeSingle() {
          const r = run();
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
          return Promise.resolve({ data, error: r.error });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q as never;
    },
  };
  if (!opts.noRpc) {
    db.rpc = (fn, args) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpcImpl ? opts.rpcImpl(fn, args, tables) : { data: null, error: { code: "42883", message: "function does not exist" } });
    };
  }
  return { db, calls, rpcCalls, tables };
}

/** The 0106 function as the database plays it, closely enough for the app's own checks: only a `sent` row, the signature, the accept. */
export function signAndAcceptImpl(fn: string, a: Record<string, unknown>, tables: Record<string, Row[]>) {
  if (fn !== "client_proposal_sign_and_accept") return { data: null, error: { code: "42883", message: "no such function" } };
  const row = (tables.client_proposal ?? []).find((r) => r.id === a.p_proposal_id);
  if (!row || row.status !== "sent") return { data: null, error: { code: "23514", message: "loe_sign_not_sent: only a live proposal can be signed" } };
  const id = "sig-0001";
  (tables.client_proposal_signature ??= []).push({ id, proposal_id: row.id, org_id: row.org_id, signer_name: a.p_signer_name, agreement_sha256: a.p_agreement_sha256 });
  row.status = "accepted";
  row.accepted_selection = a.p_selection;
  row.accepted_snapshot = {
    ...(a.p_snapshot as Row),
    schema: 2,
    agreement: { signature_id: id, signer_name: a.p_signer_name, signed_at: "2026-10-20T15:00:01.000Z", sha256: a.p_agreement_sha256, template_version: 3 },
  };
  return { data: id, error: null };
}
