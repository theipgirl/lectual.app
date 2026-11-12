import { beforeEach, describe, expect, it, vi } from "vitest";
import { sevetri } from "./fixture";

/** P5c: a reset writes status: sent and nothing else. It never touches the signature table (earlier signature rows are kept). */

type Row = Record<string, unknown>;
const ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-19T12:00:00.123456+00:00";

let touched: Array<{ table: string; op: string }> = [];
let table: Row[] = [];

function builder(name: string) {
  const filters: Array<[string, unknown]> = [];
  let op = "select";
  let payload: Row = {};
  const run = () => {
    touched.push({ table: name, op });
    if (name !== "client_proposal") return { data: [], error: null };
    const hit = table.filter((r) => filters.every(([c, v]) => r[c] === v));
    if (op === "update") for (const r of hit) Object.assign(r, payload, { updated_at: "2026-10-19T12:00:09.000000+00:00" });
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Row) => ((op = "update"), (payload = p), q),
    insert: (p: Row) => ((op = "insert"), (payload = p), q),
    delete: () => ((op = "delete"), q),
    eq: (c: string, v: unknown) => (filters.push([c, v]), q),
    maybeSingle: () => {
      const r = run();
      return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: r.error });
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (name: string) => builder(name),
    rpc: async (fn: string) => ({ data: fn === "current_org_role" ? "owner" : "org-1", error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));

import { resetProposalAcceptance } from "@/lib/proposals/store";

beforeEach(() => {
  touched = [];
  table = [
    { id: ID, org_id: "org-1", family_id: ID, version: 1, status: "accepted", client_name: "Sevetri Wilson", client_email: "s@example.com", title: "T", content: sevetri(), expires_on: "2099-12-31", pay_url: "https://pay.example.com/pay", lead_id: null, matter_id: null, updated_at: T0 },
  ];
});

describe("reset acceptance and the signature table", () => {
  it("issues no select, insert, update or delete against client_proposal_signature; the only write is on client_proposal", async () => {
    await resetProposalAcceptance(ID, { expectedUpdatedAt: T0 });
    expect(touched.some((t) => t.table === "client_proposal_signature")).toBe(false);
    const writes = touched.filter((t) => t.op !== "select");
    expect(writes).toEqual([{ table: "client_proposal", op: "update" }]);
  });
});
