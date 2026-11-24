import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/intake-forms/lawmatics-sync", () => ({ firmToken: async () => "tok" }));

import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { resetLeadMergeSupport } from "@/lib/leads/live";
import type { LawmaticsClient, ListResult } from "@/lib/lawmatics/client";

const { runLawmaticsDailySync, MIN_PREP_START_MS } = await import("@/lib/lawmatics/daily-sync");

type Row = Record<string, unknown>;
const NOW = new Date("2026-11-23T14:00:00Z");
const list = (records: Row[] = []): ListResult => ({ records, included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false });
const client: LawmaticsClient = { listAll: async () => list(), get: async () => ({}) };

function world(connections: Row[]) {
  const tables: Record<string, Row[]> = {
    lawmatics_connection: connections,
    crm_stage: [{ id: "s-new", org_id: "A", name: "Potential New Client", category: "open", order_index: 1 }, { id: "s-new-b", org_id: "B", name: "Potential New Client", category: "open", order_index: 1 }],
    crm_lead: [],
    crm_matter: [],
    crm_matter_stage: [],
    crm_activity: [],
    crm_calendar_event: [],
  };
  const handler = (q: Recorded) => {
    const rows = tables[q.table] ?? [];
    if (q.action === "select") return { data: rows.filter((r) => q.filters.every((f) => (f.op === "eq" ? r[f.column] === f.value : true))), error: null };
    return { data: [], error: null };
  };
  const { client: admin } = fakeAdmin(handler);
  return { admin: admin as never };
}

const run = (w: ReturnType<typeof world>, over: Record<string, unknown> = {}) =>
  runLawmaticsDailySync({ admin: w.admin, client: () => client, getToken: async () => "tok", now: () => NOW, mode: "daytime", ...over });

beforeEach(() => resetLeadMergeSupport());

describe("the Lawmatics sync starts consult prep for each firm after its consult step", () => {
  it("calls the hook once per firm with that firm's own org, after its consults; counts it", async () => {
    const w = world([{ id: "c1", org_id: "A", status: "active" }, { id: "c2", org_id: "B", status: "active" }]);
    const seen: string[] = [];
    const s = await run(w, { afterConsults: async (orgId: string) => (seen.push(orgId), "ran" as const) });
    expect(seen.sort()).toEqual(["A", "B"]);
    expect(s.consultPrep).toEqual({ ran: 2, notOn: 0, skippedForTime: 0, failed: 0 });
  });

  it("a firm that has not switched the assistant on is counted, not run", async () => {
    const w = world([{ id: "c1", org_id: "A", status: "active" }]);
    const s = await run(w, { afterConsults: async () => "not-on" as const });
    expect(s.consultPrep).toEqual({ ran: 0, notOn: 1, skippedForTime: 0, failed: 0 });
  });

  it("a hook that throws can never change the sync's result: it is counted, and the other firm's still runs", async () => {
    const w = world([{ id: "c1", org_id: "A", status: "active" }, { id: "c2", org_id: "B", status: "active" }]);
    const seen: string[] = [];
    const base = await run(world([{ id: "c1", org_id: "A", status: "active" }, { id: "c2", org_id: "B", status: "active" }]));
    const s = await run(w, {
      afterConsults: async (orgId: string) => {
        seen.push(orgId);
        if (orgId === "A") throw new Error("boom planted-secret");
        return "ran" as const;
      },
    });
    expect(seen.sort()).toEqual(["A", "B"]);
    expect(s.consultPrep).toEqual({ ran: 1, notOn: 0, skippedForTime: 0, failed: 1 });
    expect(JSON.stringify(s)).not.toContain("planted-secret");
    expect({ ...s, consultPrep: null }).toEqual({ ...base, consultPrep: null });
  });

  it("with too little of the wall budget left the sweep is skipped and counted, never started", async () => {
    let t = 0;
    const slow: LawmaticsClient = {
      listAll: async (path) => {
        if (path === "/events") t += 75_000; // the consult step eats the wall budget
        return list();
      },
      get: async () => ({}),
    };
    const hook = vi.fn(async () => "ran" as const);
    const w = world([{ id: "c1", org_id: "A", status: "active" }]);
    const s = await runLawmaticsDailySync({ admin: w.admin, client: () => slow, getToken: async () => "tok", now: () => NOW, mode: "daytime", budgetMs: 100_000, clock: () => t, afterConsults: hook });
    expect(MIN_PREP_START_MS).toBe(30_000);
    expect(hook).not.toHaveBeenCalled();
    expect(s.consultPrep).toEqual({ ran: 0, notOn: 0, skippedForTime: 1, failed: 0 });
  });

  it("no hook given (the button, other tests): no prep, counts at zero", async () => {
    const s = await run(world([{ id: "c1", org_id: "A", status: "active" }]));
    expect(s.consultPrep).toEqual({ ran: 0, notOn: 0, skippedForTime: 0, failed: 0 });
  });
});
