import type { EsignDb } from "@/lib/esign/db";
import type { PublicProposalsDb } from "@/lib/proposals/public";

export type Row = Record<string, unknown>;
export type Op = "select" | "update" | "insert" | "delete";
export type Call = { table: string; op: Op; filters: Array<[string, string, unknown]>; payload?: unknown; columns?: string; at: number };
export type RpcCall = { fn: string; args: Record<string, unknown>; at: number };

let clock = 0;
/** One global sequence across every fake (db calls, rpc calls, fetch calls), so tests can check order. */
export function tick(): number {
  clock += 1;
  return clock;
}

type RpcImpl = (fn: string, args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: { code?: string; message?: string } | null };

/**
 * A PostgREST-ish fake for the e-sign code AND the public proposal read: `.eq`, `.in`, `.lt` filters ANDed, update/delete only
 * touching matching rows (with `.select()` after them returning the rows touched), `order`, `limit`, `maybeSingle`, and an `rpc`
 * whose behaviour the test supplies. `failOn` makes a table answer an error for an op.
 */
export function esignDb(tables: Record<string, Row[]>, opts: { rpcImpl?: RpcImpl; failOn?: Record<string, { op?: Op; code: string }> } = {}) {
  const calls: Call[] = [];
  const rpcCalls: RpcCall[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [], at: 0 };
      let orderBy: { column: string; ascending: boolean } | null = null;
      let max = Infinity;
      let selectAfter = false;
      const matches = (r: Row) =>
        call.filters.every(([kind, c, v]) =>
          kind === "eq" ? r[c] === v : kind === "in" ? (v as unknown[]).includes(r[c]) : kind === "lt" ? String(r[c]) < String(v) : true,
        );
      const run = () => {
        call.at = tick();
        calls.push(call);
        const fail = opts.failOn?.[table];
        if (fail && (!fail.op || fail.op === call.op)) return { data: null, error: { code: fail.code, message: "x" } };
        const rows = tables[table] ?? (tables[table] = []);
        const hit = rows.filter(matches);
        if (call.op === "insert") {
          const list = Array.isArray(call.payload) ? (call.payload as Row[]) : [call.payload as Row];
          const added = list.map((p) => ({ id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...p }));
          rows.push(...added);
          return { data: selectAfter ? added.map((r) => ({ ...r })) : null, error: null };
        }
        if (call.op === "update") {
          for (const r of hit) Object.assign(r, call.payload);
          return { data: selectAfter ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        if (call.op === "delete") {
          tables[table] = rows.filter((r) => !hit.includes(r));
          return { data: selectAfter ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        let out = hit.map((r) => ({ ...r }));
        if (orderBy) {
          const { column, ascending } = orderBy;
          out = out.sort((a, b) => ((a[column] as number | string) > (b[column] as number | string) ? 1 : -1) * (ascending ? 1 : -1));
        }
        return { data: out.slice(0, max), error: null };
      };
      const q: Record<string, unknown> = {
        select(columns: string) {
          if (call.op === "select") call.columns = columns;
          else selectAfter = true;
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
        delete() {
          call.op = "delete";
          return q;
        },
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return q;
        },
        in(column: string, values: unknown[]) {
          call.filters.push(["in", column, values]);
          return q;
        },
        lt(column: string, value: unknown) {
          call.filters.push(["lt", column, value]);
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
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args, at: tick() });
      return Promise.resolve(opts.rpcImpl ? opts.rpcImpl(fn, args, tables) : { data: null, error: { code: "42883", message: "function does not exist" } });
    },
  };
  return { db: db as unknown as EsignDb & PublicProposalsDb, calls, rpcCalls, tables };
}

/** lectual 0113's `client_proposal_esign_open`, as the database plays it closely enough for the app's checks. */
export const esignOpenImpl: RpcImpl = (fn, a, tables) => {
  if (fn !== "client_proposal_esign_open") return { data: null, error: { code: "42883", message: "no such function" } };
  const p = (tables.client_proposal ?? []).find((r) => r.id === a.p_proposal_id);
  if (!p || p.status !== "sent" || p.org_id !== a.p_org_id) return { data: null, error: { code: "23514", message: "esign_proposal_changed: x" } };
  const reqs = (tables.client_proposal_esign_request ??= []);
  if (reqs.some((r) => r.proposal_id === a.p_proposal_id && (r.status === "creating" || r.status === "out_for_signature"))) {
    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
  }
  const id = `req-${reqs.length + 1}`;
  reqs.push({
    id,
    org_id: p.org_id,
    proposal_id: p.id,
    family_id: a.p_family_id,
    version: a.p_version,
    connection_id: a.p_connection_id,
    status: "creating",
    signer_name: a.p_signer_name,
    agreement_text: a.p_agreement_text,
    agreement_sha256: a.p_agreement_sha256,
    canonical_fingerprint: a.p_canonical_fingerprint,
    sent_pdf_sha256: a.p_sent_pdf_sha256,
    selection: a.p_selection,
    snapshot: a.p_snapshot,
    details: a.p_details,
    signer_email: a.p_signer_email,
    adobe_agreement_id: null,
    cancel_failed: false,
    last_error: null,
    created_at: new Date().toISOString(),
  });
  return { data: id, error: null };
};

export type FetchCall = { method: string; url: string; body: unknown; headers: Record<string, string>; at: number };

/**
 * A fake Adobe: `routes` answers by "METHOD path-suffix" (the first key the URL ends with). Records every call. NO network.
 */
export function fakeAdobe(routes: Record<string, (call: FetchCall) => Response | Promise<Response>>) {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = String(input);
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // form bodies stay strings
      }
    }
    const call: FetchCall = { method, url, body, headers: (init?.headers ?? {}) as Record<string, string>, at: tick() };
    calls.push(call);
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((k) => {
      const [m, suffix] = k.split(" ");
      return m === method && (path.endsWith(suffix) || new RegExp(`${suffix}$`).test(path));
    });
    if (!key) return new Response(JSON.stringify({ code: "NOT_FOUND_IN_FAKE" }), { status: 404 });
    return routes[key](call);
  };
  return { fetchImpl, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
