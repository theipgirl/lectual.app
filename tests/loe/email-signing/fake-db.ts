import type { SigningDb } from "@/lib/loe/email-signing/db";

/**
 * A programmable fake of the service-role client for the emailed-signing tests. Tables of rows with `.eq` filters ANDed together,
 * `update` touching matching rows, `order` / `limit`, `maybeSingle`, and an `rpc` whose answers a test supplies per function.
 * Every call is logged, so a test can say "no rpc", "no write" or "this exact argument list". Nothing here reaches a network.
 */

export type Row = Record<string, unknown>;
export type DbErr = { code?: string; message?: string } | null;
export type RpcAnswer = { data: unknown; error: DbErr } | (() => { data: unknown; error: DbErr }) | Error;
export type Call = { table: string; op: "select" | "update"; filters: Array<[string, unknown]>; columns?: string; payload?: unknown };

export function fakeSigningDb(
  tables: Record<string, Row[]> = {},
  rpcs: Record<string, RpcAnswer | RpcAnswer[]> = {},
  opts: { tableErrors?: Record<string, DbErr>; embed?: (row: Row) => Row } = {},
) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const counters: Record<string, number> = {};
  const db: SigningDb = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      let max = Infinity;
      let selectAfterUpdate = false;
      const run = (): { data: unknown; error: DbErr } => {
        calls.push(call);
        const err = opts.tableErrors?.[table];
        if (err) return { data: null, error: err };
        const rows = tables[table] ?? (tables[table] = []);
        const matching = rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
        if (call.op === "update") {
          for (const r of matching) Object.assign(r, call.payload);
          return { data: selectAfterUpdate ? matching.map((r) => ({ ...r })) : null, error: null };
        }
        let out = matching.map((r) => ({ ...r }));
        if (table === "client_proposal_signing_request" && opts.embed) out = out.map(opts.embed);
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
        eq(c: string, v: unknown) {
          call.filters.push([c, v]);
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
          const r = run();
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q as never;
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ fn, args });
      const planned = rpcs[fn];
      let answer: RpcAnswer | undefined;
      if (Array.isArray(planned)) {
        const i = counters[fn] ?? 0;
        counters[fn] = i + 1;
        answer = planned[Math.min(i, planned.length - 1)];
      } else answer = planned;
      if (answer === undefined) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "not planned" } });
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(typeof answer === "function" ? answer() : answer);
    },
  };
  return { db, calls, rpcCalls, tables };
}

export const ok = (data: unknown): RpcAnswer => ({ data, error: null });
export const err = (code: string, message = ""): RpcAnswer => ({ data: null, error: { code, message } });

export const ORG = "0a0a0a0a-0000-4000-8000-000000000001";
export const OTHER_ORG = "0b0b0b0b-0000-4000-8000-000000000002";
export const WORDS_ROW = {
  id: "0c0c0c0c-0000-4000-8000-000000000003",
  org_id: ORG,
  version: 1,
  status: "approved",
  consent_line: "Firm consent line (test)",
  consent_text: "Firm consent text (test).",
  sign_line: "Firm sign line (test)",
  box_note: "Firm box note (test)",
  link_subject: "Your letter from {{firm_name}}",
  link_body: "Hello {{client_name}}, sign here: {{signing_link}} (until {{link_expires}}).",
  copy_subject: "Your signed letter",
  copy_body: "Attached, {{client_name}}.",
};
export const ON_ENV = {
  LOE_EMAIL_SIGNING: "on",
  RESEND_API_KEY: "re_test_key",
  FIRM_CLIENT_MAIL_FROM: JSON.stringify({ [ORG]: "Sample Firm <signing@sample-firm.example>" }),
  SITE_URL: "https://app.lectual.app",
};
