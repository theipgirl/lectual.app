import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake Supabase query builder ────────────────────────────────────────────
// Chain methods record their calls and return `this`; the object is itself
// thenable so `await query` resolves regardless of which method was called
// last (mirrors how supabase-js PostgrestFilterBuilder behaves). Mirrors
// tests/pipeline/leads.test.ts's FakeQuery, extended with `count` (for the
// head-count select used by matter-number generation).
class FakeQuery
  implements PromiseLike<{ data: unknown; error: unknown; count?: unknown }>
{
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown; count?: unknown }) {}
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
  update(...a: unknown[]) {
    this.calls.push(["update", a]);
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
  then<TResult1 = { data: unknown; error: unknown; count?: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown;
          error: unknown;
          count?: unknown;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const state = vi.hoisted(() => ({
  role: "attorney" as string | null,
  // Queued per-call results, shifted in call order; falls back to
  // `fromResult` once exhausted. Lets a single test script a sequence like
  // [count-select, insert] without every `.from()` call sharing one result.
  queue: [] as Array<{ data: unknown; error: unknown; count?: unknown }>,
  fromResult: { data: [] as unknown, error: null as unknown } as {
    data: unknown;
    error: unknown;
    count?: unknown;
  },
  queries: [] as FakeQuery[],
  fromTables: [] as string[],
}));

const mockFrom = vi.fn((table: string) => {
  const result = state.queue.length > 0 ? state.queue.shift()! : state.fromResult;
  const q = new FakeQuery(result);
  state.queries.push(q);
  state.fromTables.push(table);
  return q;
});
const mockRpc = vi.fn(() =>
  Promise.resolve({ data: state.role, error: null as unknown }),
);

const mockGetUser = vi.fn(async () => ({ data: { user: { id: "actor-1" } }, error: null as unknown }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getUser: mockGetUser },
  })),
}));

const {
  listMatters,
  createMatter,
  updateMatterStatus,
  updateMatterNotes,
  assignMatterOwner,
  MATTER_WRITE_ROLES,
} = await import("@/lib/matters/matters");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "attorney";
  state.queue = [];
  state.fromResult = { data: [], error: null };
  state.queries = [];
  state.fromTables = [];
});

function lastInsertQuery(): FakeQuery {
  const q = [...state.queries]
    .reverse()
    .find((query) => query.calls.some(([name]) => name === "insert"));
  if (!q) throw new Error("no insert query recorded");
  return q;
}

describe("MATTER_WRITE_ROLES membership", () => {
  it("excludes social_media and viewer", () => {
    expect(MATTER_WRITE_ROLES).not.toContain("social_media");
    expect(MATTER_WRITE_ROLES).not.toContain("viewer");
  });
  it("includes paralegal (unlike CAN_MOVE_STAGE for leads)", () => {
    expect(MATTER_WRITE_ROLES).toContain("paralegal");
  });
});

describe("createMatter matter_number generation", () => {
  it("formats as `${type}-${year}-${4-digit}`, derived from count + 1", async () => {
    state.queue = [
      { data: null, error: null, count: 41 },
      {
        data: { id: "matter-1", type: "TM", matter_number: "TM-placeholder" },
        error: null,
      },
    ];

    await createMatter({ type: "TM" });

    const year = new Date().getFullYear();
    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.matter_number).toBe(`TM-${year}-0042`);
  });

  it("zero-pads to 4 digits for small counts", async () => {
    state.queue = [
      { data: null, error: null, count: 0 },
      { data: { id: "matter-2" }, error: null },
    ];

    await createMatter({ type: "CR" });

    const year = new Date().getFullYear();
    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.matter_number).toBe(`CR-${year}-0001`);
  });

  it("does not pad past 4 digits for large counts", async () => {
    state.queue = [
      { data: null, error: null, count: 12345 },
      { data: { id: "matter-3" }, error: null },
    ];

    await createMatter({ type: "TM" });

    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.matter_number).toMatch(/^TM-\d{4}-12346$/);
  });

  it("uses the caller-supplied matterNumber verbatim when given, skipping the count lookup", async () => {
    state.queue = [{ data: { id: "matter-4" }, error: null }];

    await createMatter({ type: "TM", matterNumber: "TM-CUSTOM-0007" });

    const insertCall = lastInsertQuery().calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.matter_number).toBe("TM-CUSTOM-0007");
  });
});

describe("createMatter role gating", () => {
  it("allows paralegal", async () => {
    state.role = "paralegal";
    state.queue = [
      { data: null, error: null, count: 0 },
      { data: { id: "matter-1" }, error: null },
    ];
    await expect(createMatter({ type: "TM" })).resolves.toBeTruthy();
  });

  it("rejects viewer without touching the DB", async () => {
    state.role = "viewer";
    await expect(createMatter({ type: "TM" })).rejects.toThrow(/Forbidden/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects social_media", async () => {
    state.role = "social_media";
    await expect(createMatter({ type: "TM" })).rejects.toThrow(/Forbidden/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws when the caller has no resolvable role", async () => {
    state.role = null;
    await expect(createMatter({ type: "TM" })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("updateMatterStatus role gating", () => {
  it("allows paralegal and stamps updated_at", async () => {
    state.role = "paralegal";
    state.fromResult = {
      data: { id: "matter-1", status: "closed" },
      error: null,
    };

    const before = Date.now();
    const result = (await updateMatterStatus("matter-1", "closed")) as {
      id: string;
    };
    expect(result.id).toBe("matter-1");

    expect(mockFrom).toHaveBeenCalledWith("crm_matter");
    const updateCall = state.queries[0].calls.find(([name]) => name === "update");
    expect(updateCall).toBeTruthy();
    const payload = updateCall![1][0] as Record<string, unknown>;
    expect(payload.status).toBe("closed");
    expect(typeof payload.updated_at).toBe("string");
    expect(Date.parse(payload.updated_at as string)).toBeGreaterThanOrEqual(before);
  });

  it("rejects viewer", async () => {
    state.role = "viewer";
    await expect(updateMatterStatus("matter-1", "closed")).rejects.toThrow(
      /Forbidden/,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("updateMatterNotes role gating", () => {
  it("allows a paralegal-tier write role and stamps updated_at", async () => {
    state.role = "paralegal";
    state.fromResult = {
      data: { id: "matter-1", notes: "Client wants an expedited filing." },
      error: null,
    };

    const before = Date.now();
    const result = (await updateMatterNotes("matter-1", "Client wants an expedited filing.")) as {
      id: string;
    };
    expect(result.id).toBe("matter-1");

    expect(mockFrom).toHaveBeenCalledWith("crm_matter");
    const updateCall = state.queries[0].calls.find(([name]) => name === "update");
    expect(updateCall).toBeTruthy();
    const payload = updateCall![1][0] as Record<string, unknown>;
    expect(payload.notes).toBe("Client wants an expedited filing.");
    expect(typeof payload.updated_at).toBe("string");
    expect(Date.parse(payload.updated_at as string)).toBeGreaterThanOrEqual(before);
  });

  it("rejects viewer without touching the DB", async () => {
    state.role = "viewer";
    await expect(updateMatterNotes("matter-1", "hijacked")).rejects.toThrow(/Forbidden/);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("assignMatterOwner — 'whose court is it in'", () => {
  it("rejects a role outside MATTER_WRITE_ROLES before touching the table", async () => {
    state.role = "viewer";
    await expect(assignMatterOwner("matter-1", "user-9")).rejects.toThrow(/Forbidden/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("re-submitting the same owner does not write an activity row", async () => {
    state.role = "attorney";
    state.queue = [
      { data: { assigned_to: "user-9" }, error: null }, // before-read
      { data: { id: "matter-1", assigned_to: "user-9" }, error: null }, // update
    ];

    await assignMatterOwner("matter-1", "user-9");

    // Only crm_matter is touched — no crm_activity insert for a no-op reassign.
    expect(state.fromTables).toEqual(["crm_matter", "crm_matter"]);
  });

  it("a real reassignment logs a matter_updated/owner_assigned activity row", async () => {
    state.role = "attorney";
    state.queue = [
      { data: { assigned_to: "user-old" }, error: null }, // before-read
      { data: { id: "matter-1", assigned_to: "user-new" }, error: null }, // update
      { data: { org_id: "org-1" }, error: null }, // logActivity's org lookup
      { data: null, error: null }, // crm_activity insert
    ];

    const result = (await assignMatterOwner("matter-1", "user-new")) as { assigned_to: string };
    expect(result.assigned_to).toBe("user-new");

    expect(state.fromTables).toEqual(["crm_matter", "crm_matter", "crm_matter", "crm_activity"]);
    const insertCall = state.queries[3].calls.find(([name]) => name === "insert");
    const payload = insertCall![1][0] as { type: string; payload: Record<string, unknown> };
    expect(payload.type).toBe("matter_updated");
    expect(payload.payload).toMatchObject({
      change: "owner_assigned",
      from_user_id: "user-old",
      to_user_id: "user-new",
    });
  });

  it("clearing an owner (null) is a real change too", async () => {
    state.role = "attorney";
    state.queue = [
      { data: { assigned_to: "user-old" }, error: null },
      { data: { id: "matter-1", assigned_to: null }, error: null },
      { data: { org_id: "org-1" }, error: null },
      { data: null, error: null },
    ];

    await assignMatterOwner("matter-1", null);
    expect(state.fromTables).toContain("crm_activity");
  });
});

describe("listMatters filter/sort behavior", () => {
  it("applies no filters by default and orders by created_at desc", async () => {
    await listMatters();
    const q = state.queries[0];
    const eqCalls = q.calls.filter(([name]) => name === "eq");
    expect(eqCalls).toHaveLength(0);
    const orderCall = q.calls.find(([name]) => name === "order");
    expect(orderCall).toBeTruthy();
    expect(orderCall![1]).toEqual(["created_at", { ascending: false }]);
  });

  it("applies status and leadId as eq filters", async () => {
    await listMatters({ status: "open", leadId: "lead-1" });
    const q = state.queries[0];
    const eqCalls = q.calls.filter(([name]) => name === "eq");
    expect(eqCalls).toEqual([
      ["eq", ["status", "open"]],
      ["eq", ["lead_id", "lead-1"]],
    ]);
  });

  it("is not role-gated (no rpc call)", async () => {
    await listMatters();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
