import { describe, it, expect, vi, beforeEach } from "vitest";

import { ProposalError } from "@/lib/proposals/errors";
import { sevetri } from "./fixture";

/**
 * resetProposalAcceptance (lectual 0101) against a fake scoped client (the same fake as pay-link-store.test.ts).
 * `dbError` stands in for the lifecycle trigger: before 0101 it answers client_proposal_bad_transition.
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

import { resetProposalAcceptance } from "@/lib/proposals/store";
import { RESET_NEEDS_DB_UPDATE, RESET_NOT_ACCEPTED, RESET_PAID } from "@/lib/proposal-editor/reset-acceptance";

function row(over: Row = {}): Row {
  return {
    id: ID, org_id: "org-1", family_id: ID, version: 1, status: "accepted", client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com", title: "Trademark Proposal", content: sevetri(), expires_on: "2099-12-31",
    pay_url: "https://pay.example.com/pay", lead_id: null, matter_id: null, updated_at: T0, ...over,
  };
}

beforeEach(() => {
  table = [row()];
  events = [];
  updates = [];
  dbError = null;
  role = "owner";
});

const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e as ProposalError);

describe("resetProposalAcceptance", () => {
  it("writes ONLY status: sent, fenced on status accepted and the rendered updated_at, and writes no event itself", async () => {
    const saved = await resetProposalAcceptance(ID, { expectedUpdatedAt: T0 });
    expect(saved.status).toBe("sent");
    expect(updates).toHaveLength(1);
    // Never the acceptance columns: authenticated has no privilege on them, and the 0101 trigger clears them.
    expect(updates[0].patch).toEqual({ status: "sent" });
    expect(updates[0].filters).toEqual([["id", ID], ["status", "accepted"], ["updated_at", T0]]);
    // The 0101 trigger writes the reset event with the previous acceptance; a second one here would duplicate it.
    expect(events).toHaveLength(0);
  });

  it.each(["draft", "approved", "sent", "superseded", "withdrawn"])("refuses a %s version before the database", async (status) => {
    table = [row({ status })];
    const err = await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "conflict", message: RESET_NOT_ACCEPTED });
    expect(updates).toHaveLength(0);
  });

  it("before 0101 is applied the trigger's client_proposal_bad_transition reads as 'isn't switched on yet'", async () => {
    dbError = { code: "23514", message: "client_proposal_bad_transition: accepted -> sent is not allowed" };
    const err = await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "unavailable", message: RESET_NEEDS_DB_UPDATE });
    expect(err!.message).toBe("Resetting an acceptance isn't switched on for your firm yet. Lectual will turn it on.");
  });

  it("maps the 0101 refusals to fixed sentences, never the raw text", async () => {
    dbError = { code: "23514", message: "client_proposal_reset_paid: this proposal is marked paid; undo the paid mark before resetting the acceptance" };
    const err = await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }));
    expect(err).toMatchObject({ code: "conflict", message: RESET_PAID });
    dbError = { code: "42501", message: "client_proposal_reset_not_allowed: only the owner, an admin ..." };
    const denied = await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }));
    expect(denied).toMatchObject({ code: "forbidden" });
    expect(denied!.message).not.toContain("client_proposal");
  });

  it("refuses a stale page, a missing updated_at and a role that can't write", async () => {
    table = [row({ updated_at: "2026-10-19T12:05:00.000000+00:00" })];
    expect(await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }))).toMatchObject({ code: "conflict" });
    table = [row()];
    expect(await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: "" }))).toMatchObject({ code: "conflict" });
    role = "viewer";
    expect(await fail(resetProposalAcceptance(ID, { expectedUpdatedAt: T0 }))).toMatchObject({ code: "forbidden" });
    expect(updates).toHaveLength(0);
  });
});
