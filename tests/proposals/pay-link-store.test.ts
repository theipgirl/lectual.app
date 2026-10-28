import { describe, it, expect, vi, beforeEach } from "vitest";

import { ProposalError } from "@/lib/proposals/errors";
import { sevetri } from "./fixture";

/**
 * changeLivePayLink against a fake scoped client (the same PostgREST-shaped fake as update.test.ts).
 * `dbError` stands in for the lifecycle trigger: before lectual 0100 it answers client_proposal_frozen.
 */

type Row = Record<string, unknown>;
const ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-19T12:00:00.123456+00:00";

let table: Row[] = [];
let events: Row[] = [];
let updates: Array<{ filters: Array<[string, unknown]>; patch: Row }> = [];
let dbError: { code: string; message: string } | null = null;

function builder(name: string) {
  const filters: Array<[string, unknown]> = [];
  let op: "select" | "update" | "insert" = "select";
  let payload: Row = {};
  const run = () => {
    if (name === "client_proposal_event") {
      if (op === "insert") events.push(payload);
      return { data: null, error: null };
    }
    if (op === "update") {
      updates.push({ filters: [...filters], patch: payload });
      if (dbError) return { data: null, error: dbError };
    }
    const hit = table.filter((r) => filters.every(([c, v]) => r[c] === v));
    if (op === "update") for (const r of hit) Object.assign(r, payload, { updated_at: "2026-10-19T12:00:09.000000+00:00" });
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Row) => ((op = "update"), (payload = p), q),
    insert: (p: Row) => ((op = "insert"), (payload = p), q),
    eq: (c: string, v: unknown) => (filters.push([c, v]), q),
    maybeSingle: () => {
      const r = run();
      return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

let role = "paralegal";
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (name: string) => builder(name),
    rpc: async (fn: string) => ({ data: fn === "current_org_role" ? role : "org-1", error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));

import { changeLivePayLink } from "@/lib/proposals/store";
import { PAY_LINK_NEEDS_DB_UPDATE, PAY_LINK_NOT_LIVE } from "@/lib/proposal-editor/pay-link";

function row(over: Row = {}): Row {
  return {
    id: ID, org_id: "org-1", family_id: ID, version: 1, status: "sent", client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com", title: "Trademark Proposal", content: sevetri(), expires_on: "2099-12-31",
    pay_url: "https://wrong.example.com/pay", lead_id: null, matter_id: null, updated_at: T0, ...over,
  };
}

beforeEach(() => {
  table = [row()];
  events = [];
  updates = [];
  dbError = null;
  role = "paralegal";
});

const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e as ProposalError);

describe("changeLivePayLink", () => {
  it("writes ONLY pay_url, fenced on status sent and the rendered updated_at, and writes no event itself", async () => {
    const saved = await changeLivePayLink(ID, " https://app.lawmatics.com/forms/right ", { expectedUpdatedAt: T0 });
    expect(saved.pay_url).toBe("https://app.lawmatics.com/forms/right");
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ pay_url: "https://app.lawmatics.com/forms/right" });
    expect(updates[0].filters).toEqual([["id", ID], ["status", "sent"], ["updated_at", T0]]);
    // The 0100 trigger writes the edited event (hosts only); a second one here would duplicate it.
    expect(events).toHaveLength(0);
  });

  it.each(["draft", "approved", "accepted", "superseded", "withdrawn"])("refuses a %s version before the database", async (status) => {
    table = [row({ status })];
    const err = await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "frozen", message: PAY_LINK_NOT_LIVE });
    expect(updates).toHaveLength(0);
  });

  it("before 0100 is applied the trigger's client_proposal_frozen reads as 'isn't switched on yet'", async () => {
    dbError = { code: "23514", message: "client_proposal_frozen: a sent proposal is frozen and cannot be edited; revise it as a new version" };
    const err = await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "unavailable", message: PAY_LINK_NEEDS_DB_UPDATE });
    expect(err!.message).toBe("Changing the pay link isn't switched on for your firm yet. Lectual will turn it on.");
  });

  it("maps the 0100 refusals to fixed sentences, never the raw text", async () => {
    dbError = { code: "42501", message: "client_proposal_pay_link_staff_only: only a signed-in staff member can change ..." };
    const err = await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "forbidden" });
    expect(err!.message).not.toContain("client_proposal");
  });

  it("refuses a stale page, a non-https link, an unchanged link and a role that can't write", async () => {
    table = [row({ updated_at: "2026-10-19T12:05:00.000000+00:00" })];
    expect(await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }))).toMatchObject({ code: "conflict" });
    table = [row()];
    expect(await fail(changeLivePayLink(ID, "http://ok.example.com/p", { expectedUpdatedAt: T0 }))).toMatchObject({ code: "validation" });
    expect(await fail(changeLivePayLink(ID, "https://wrong.example.com/pay", { expectedUpdatedAt: T0 }))).toMatchObject({ code: "validation" });
    role = "viewer";
    expect(await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }))).toMatchObject({ code: "forbidden" });
    expect(updates).toHaveLength(0);
  });

  it("a row that moved between the read and the write changes nothing", async () => {
    const original = table[0];
    let reads = 0;
    Object.defineProperty(table, "filter", {
      configurable: true,
      value: function (fn: (r: Row) => boolean) {
        reads += 1;
        if (reads === 2) original.status = "accepted";
        return Array.prototype.filter.call(this, fn);
      },
    });
    const err = await fail(changeLivePayLink(ID, "https://ok.example.com/p", { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "conflict" });
    expect(original.pay_url).toBe("https://wrong.example.com/pay");
  });
});
