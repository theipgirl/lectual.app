import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/matters/matters.test.ts's FakeQuery (itself mirroring
// tests/pipeline/leads.test.ts).
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown }) {}
  select(...a: unknown[]) {
    this.calls.push(["select", a]);
    return this;
  }
  eq(...a: unknown[]) {
    this.calls.push(["eq", a]);
    return this;
  }
  order(...a: unknown[]) {
    this.calls.push(["order", a]);
    return this;
  }
  limit(...a: unknown[]) {
    this.calls.push(["limit", a]);
    return this;
  }
  insert(...a: unknown[]) {
    this.calls.push(["insert", a]);
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const state = vi.hoisted(() => ({
  // Queued per-call results, shifted in call order (e.g. [lead-lookup, insert]).
  queue: [] as Array<{ data: unknown; error: unknown }>,
  fromResult: { data: [] as unknown, error: null as unknown } as {
    data: unknown;
    error: unknown;
  },
  queries: [] as FakeQuery[],
  fromTables: [] as string[],
  user: { id: "user-1" } as { id: string } | null,
}));

const mockFrom = vi.fn((table: string) => {
  const result = state.queue.length > 0 ? state.queue.shift()! : state.fromResult;
  const q = new FakeQuery(result);
  state.queries.push(q);
  state.fromTables.push(table);
  return q;
});
const mockGetUser = vi.fn(() =>
  Promise.resolve({ data: { user: state.user }, error: null as unknown }),
);

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  })),
}));

const activityModule = await import("@/lib/matters/activity");
const {
  logActivity,
  logActivitySafe,
  activityForLead,
  activityForMatter,
  recentActivity,
  hasMatterActivityType,
} = activityModule;

beforeEach(() => {
  vi.clearAllMocks();
  state.queue = [];
  state.fromResult = { data: [], error: null };
  state.queries = [];
  state.fromTables = [];
  state.user = { id: "user-1" };
});

function lastInsertQuery(): FakeQuery {
  const q = [...state.queries]
    .reverse()
    .find((query) => query.calls.some(([name]) => name === "insert"));
  if (!q) throw new Error("no insert query recorded");
  return q;
}

describe("logActivity", () => {
  it("rejects when neither leadId nor matterId is given, without touching the DB", async () => {
    await expect(logActivity({ type: "note" })).rejects.toThrow(
      /requires at least one of leadId or matterId/,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("sets org_id from the referenced lead, actor_id from the session, and defaults actor_type to 'user'", async () => {
    state.queue = [
      { data: { org_id: "org-1" }, error: null },
      { data: { id: "act-1" }, error: null },
    ];

    await logActivity({ type: "note", leadId: "lead-1", payload: { text: "hi" } });

    expect(state.fromTables[0]).toBe("crm_lead");
    const leadQuery = state.queries[0];
    expect(leadQuery.calls.some(([n, a]) => n === "eq" && a[0] === "id" && a[1] === "lead-1")).toBe(true);

    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.org_id).toBe("org-1");
    expect(payload.lead_id).toBe("lead-1");
    expect(payload.matter_id).toBeNull();
    expect(payload.actor_id).toBe("user-1");
    expect(payload.actor_type).toBe("user");
    expect(payload.type).toBe("note");
    expect(payload.payload).toEqual({ text: "hi" });
  });

  it("sets org_id from the referenced matter when leadId is absent", async () => {
    state.queue = [
      { data: { org_id: "org-2" }, error: null },
      { data: { id: "act-2" }, error: null },
    ];

    await logActivity({ type: "matter_opened", matterId: "matter-1" });

    expect(state.fromTables[0]).toBe("crm_matter");
    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.org_id).toBe("org-2");
    expect(payload.matter_id).toBe("matter-1");
    expect(payload.lead_id).toBeNull();
  });

  it("honors an explicit actorType override", async () => {
    state.queue = [
      { data: { org_id: "org-1" }, error: null },
      { data: { id: "act-3" }, error: null },
    ];

    await logActivity({ type: "ai_insight", leadId: "lead-1", actorType: "ai" });

    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.actor_type).toBe("ai");
  });
});

describe("append-only: no update/delete exported", () => {
  it("exports only read helpers plus the two append entry points", () => {
    const exported = Object.keys(activityModule).sort();
    expect(exported).toEqual(
      [
        "ACTIVITY_TYPES_0033",
        "ACTIVITY_TYPES_0036",
        "ACTIVITY_TYPES_0045",
        "ACTIVITY_TYPES_0047",
        "activityForLead",
        "activityForMatter",
        "hasMatterActivityType",
        "leadActivitySince",
        "logActivity",
        "logActivitySafe",
        "matterActivitySince",
        "recentActivity",
      ].sort(),
    );
  });

  it("has no updateActivity/deleteActivity/removeActivity function", () => {
    const asRecord = activityModule as unknown as Record<string, unknown>;
    expect(asRecord.updateActivity).toBeUndefined();
    expect(asRecord.deleteActivity).toBeUndefined();
    expect(asRecord.removeActivity).toBeUndefined();
  });
});

describe("activityForLead / activityForMatter / recentActivity", () => {
  it("activityForLead filters by lead_id and orders newest first", async () => {
    await activityForLead("lead-1");
    const q = state.queries[0];
    expect(q.calls.some(([n, a]) => n === "eq" && a[0] === "lead_id" && a[1] === "lead-1")).toBe(true);
    const orderCall = q.calls.find(([n]) => n === "order");
    expect(orderCall![1]).toEqual(["created_at", { ascending: false }]);
  });

  it("activityForMatter filters by matter_id and orders newest first", async () => {
    await activityForMatter("matter-1");
    const q = state.queries[0];
    expect(q.calls.some(([n, a]) => n === "eq" && a[0] === "matter_id" && a[1] === "matter-1")).toBe(true);
    const orderCall = q.calls.find(([n]) => n === "order");
    expect(orderCall![1]).toEqual(["created_at", { ascending: false }]);
  });

  it("recentActivity orders newest first and defaults to limit 20", async () => {
    await recentActivity();
    const q = state.queries[0];
    const orderCall = q.calls.find(([n]) => n === "order");
    expect(orderCall![1]).toEqual(["created_at", { ascending: false }]);
    const limitCall = q.calls.find(([n]) => n === "limit");
    expect(limitCall![1]).toEqual([20]);
  });

  it("recentActivity honors a custom limit", async () => {
    await recentActivity(5);
    const q = state.queries[0];
    const limitCall = q.calls.find(([n]) => n === "limit");
    expect(limitCall![1]).toEqual([5]);
  });
});

/**
 * The one-per-matter idempotency gate a one-time matter action (e.g. the
 * welcome email, src/lib/welcome/generate.ts) re-checks server-side.
 */
describe("hasMatterActivityType", () => {
  it("returns true when a matching row exists", async () => {
    state.fromResult = { data: { id: "act-1" }, error: null };
    const result = await hasMatterActivityType("matter-1", "welcome_email");
    expect(result).toBe(true);
    const q = state.queries[0];
    expect(q.calls.some(([n, a]) => n === "eq" && a[0] === "matter_id" && a[1] === "matter-1")).toBe(
      true,
    );
    expect(q.calls.some(([n, a]) => n === "eq" && a[0] === "type" && a[1] === "welcome_email")).toBe(
      true,
    );
  });

  it("returns false when no row matches", async () => {
    state.fromResult = { data: null, error: null };
    const result = await hasMatterActivityType("matter-1", "welcome_email");
    expect(result).toBe(false);
  });

  it("throws on a DB error rather than silently reporting false", async () => {
    state.fromResult = { data: null, error: { message: "boom" } };
    await expect(hasMatterActivityType("matter-1", "welcome_email")).rejects.toBeTruthy();
  });
});

/**
 * The audit-trail ordering contract (see the doc comment on logActivitySafe):
 * a failed timeline write must never roll back — or be mistaken for — the
 * mutation it describes, and the failure must stay observable in the server log.
 */
describe("logActivitySafe", () => {
  it("writes the same row logActivity would on the happy path", async () => {
    state.queue = [
      { data: { org_id: "org-1" }, error: null },
      { data: { id: "act-9" }, error: null },
    ];

    await logActivitySafe({ type: "lead_created", leadId: "lead-1", payload: { a: 1 } });

    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.type).toBe("lead_created");
    expect(payload.lead_id).toBe("lead-1");
  });

  it("swallows a failed insert so a successful mutation is never rolled back", async () => {
    state.queue = [
      { data: { org_id: "org-1" }, error: null },
      { data: null, error: { message: "audit insert failed" } },
    ];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logActivitySafe({ type: "lead_updated", leadId: "lead-1" }),
    ).resolves.toBeUndefined();

    // Swallowed for the caller, but still visible to an operator.
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain("[audit]");
    spy.mockRestore();
  });

  it("still throws from the strict logActivity, so note-style writes can surface", async () => {
    state.queue = [
      { data: { org_id: "org-1" }, error: null },
      { data: null, error: { message: "insert failed" } },
    ];
    await expect(logActivity({ type: "note", leadId: "lead-1" })).rejects.toBeTruthy();
  });
});
