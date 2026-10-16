import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake Supabase query builder ────────────────────────────────────────────
// Chain methods record their calls and return `this`; the object is itself
// thenable so `await query` resolves regardless of which method was called
// last (mirrors how supabase-js PostgrestFilterBuilder behaves).
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
  or(...a: unknown[]) {
    this.calls.push(["or", a]);
    return this;
  }
  in(...a: unknown[]) {
    this.calls.push(["in", a]);
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
  delete(...a: unknown[]) {
    this.calls.push(["delete", a]);
    return this;
  }
  limit(...a: unknown[]) {
    this.calls.push(["limit", a]);
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
  role: "attorney" as string | null,
  fromResult: { data: [] as unknown, error: null as unknown },
  lastQuery: null as FakeQuery | null,
  queries: [] as FakeQuery[],
  ensureMatter: vi.fn(),
  logActivitySafe: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}),
  orgId: "org-1" as string | null,
  // Per-table overrides; anything not listed falls back to `fromResult`.
  resultsByTable: {} as Record<string, { data: unknown; error: unknown }>,
  tables: [] as string[],
}));

const mockFrom = vi.fn((table: string) => {
  state.tables.push(table);
  const q = new FakeQuery(state.resultsByTable[table] ?? state.fromResult);
  state.lastQuery = q;
  state.queries.push(q);
  return q;
});
const mockRpc = vi.fn((fn: string) =>
  Promise.resolve({
    data: fn === "current_org_id" ? state.orgId : state.role,
    error: null as unknown,
  }),
);

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ from: mockFrom, rpc: mockRpc })),
}));

// moveLeadStage fires the pipeline→matter handoff on a 'won' move, and every
// lead mutation writes a best-effort audit row; stub both.
vi.mock("@/lib/matters", () => ({
  ensureMatterForLead: state.ensureMatter,
  logActivitySafe: state.logActivitySafe,
}));

const { listLeads, createLead, updateLead, moveLeadStage, assignLead, CAN_MOVE_STAGE, CAN_WRITE_LEAD } =
  await import("@/lib/pipeline/leads");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "attorney";
  state.orgId = "org-1";
  state.fromResult = { data: [], error: null };
  state.resultsByTable = {};
  state.lastQuery = null;
  state.queries = [];
  state.tables = [];
});

describe("CAN_MOVE_STAGE guard membership", () => {
  it("excludes paralegal, social_media, and viewer", () => {
    expect(CAN_MOVE_STAGE).not.toContain("paralegal");
    expect(CAN_MOVE_STAGE).not.toContain("social_media");
    expect(CAN_MOVE_STAGE).not.toContain("viewer");
  });
  it("includes owner/admin/senior_admin/intake/law_clerk/attorney/clerk", () => {
    for (const role of [
      "owner",
      "admin",
      "senior_admin",
      "intake",
      "law_clerk",
      "attorney",
      "clerk",
    ]) {
      expect(CAN_MOVE_STAGE).toContain(role);
    }
  });
});

describe("moveLeadStage role gating", () => {
  it("rejects paralegal even though paralegals can otherwise edit leads", async () => {
    state.role = "paralegal";
    await expect(moveLeadStage("lead-1", "stage-2")).rejects.toThrow(/Forbidden/);
    // No update should have been attempted once the guard rejects.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects social_media and viewer", async () => {
    state.role = "social_media";
    await expect(moveLeadStage("lead-1", "stage-2")).rejects.toThrow(/Forbidden/);

    state.role = "viewer";
    await expect(moveLeadStage("lead-1", "stage-2")).rejects.toThrow(/Forbidden/);
  });

  it("allows attorney and stamps stage_entered_at + last_activity_at", async () => {
    state.role = "attorney";
    state.fromResult = {
      data: { id: "lead-1", current_stage_id: "stage-2" },
      error: null,
    };

    const before = Date.now();
    const result = (await moveLeadStage("lead-1", "stage-2")) as { id: string };
    expect(result.id).toBe("lead-1");

    expect(mockFrom).toHaveBeenCalledWith("crm_lead");
    const updateCall = state.queries
      .flatMap((q) => q.calls)
      .find(([name]) => name === "update");
    expect(updateCall).toBeTruthy();
    const payload = updateCall![1][0] as Record<string, unknown>;
    expect(payload.current_stage_id).toBe("stage-2");
    expect(typeof payload.stage_entered_at).toBe("string");
    expect(typeof payload.last_activity_at).toBe("string");
    expect(Date.parse(payload.stage_entered_at as string)).toBeGreaterThanOrEqual(before);
    expect(payload.stage_entered_at).toBe(payload.last_activity_at);
  });

  it("throws when the caller has no resolvable role", async () => {
    state.role = null;
    await expect(moveLeadStage("lead-1", "stage-2")).rejects.toThrow(/Forbidden/);
  });
});

describe("moveLeadStage → matter handoff", () => {
  it("opens a matter when the destination stage is category 'won'", async () => {
    state.role = "attorney";
    state.fromResult = {
      data: { id: "lead-1", current_stage_id: "stage-hired", category: "won" },
      error: null,
    };
    await moveLeadStage("lead-1", "stage-hired");
    expect(state.ensureMatter).toHaveBeenCalledWith("lead-1");
  });

  it("does not open a matter for a non-'won' stage", async () => {
    state.role = "attorney";
    state.fromResult = {
      data: { id: "lead-1", current_stage_id: "stage-2", category: "open" },
      error: null,
    };
    await moveLeadStage("lead-1", "stage-2");
    expect(state.ensureMatter).not.toHaveBeenCalled();
  });

  it("swallows a matter-handoff failure — the stage move still succeeds", async () => {
    state.role = "attorney";
    state.fromResult = {
      data: { id: "lead-1", current_stage_id: "stage-hired", category: "won" },
      error: null,
    };
    state.ensureMatter.mockRejectedValueOnce(new Error("boom"));
    const result = (await moveLeadStage("lead-1", "stage-hired")) as { id: string };
    expect(result.id).toBe("lead-1");
  });
});

describe("assignLead", () => {
  it("is not gated by CAN_MOVE_STAGE (paralegal can assign)", async () => {
    state.role = "paralegal";
    state.fromResult = {
      data: { id: "lead-1", assigned_to: "user-9" },
      error: null,
    };
    const result = (await assignLead("lead-1", "user-9")) as { assigned_to: string };
    expect(result.assigned_to).toBe("user-9");
    // rpc (role check) should never be called — assignLead has no role gate.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("listLeads filter/sort behavior", () => {
  it("applies no filters by default and orders by last_activity_at desc, nulls last", async () => {
    await listLeads();
    const q = state.lastQuery!;
    const eqCalls = q.calls.filter(([name]) => name === "eq");
    const orCalls = q.calls.filter(([name]) => name === "or");
    expect(eqCalls).toHaveLength(0);
    expect(orCalls).toHaveLength(0);
    const orderCall = q.calls.find(([name]) => name === "order");
    expect(orderCall).toBeTruthy();
    expect(orderCall![1]).toEqual([
      "last_activity_at",
      { ascending: false, nullsFirst: false },
    ]);
  });

  it("applies stageId and assignedTo as eq filters", async () => {
    await listLeads({ stageId: "stage-1", assignedTo: "user-1" });
    const q = state.lastQuery!;
    const eqCalls = q.calls.filter(([name]) => name === "eq");
    expect(eqCalls).toEqual([
      ["eq", ["current_stage_id", "stage-1"]],
      ["eq", ["assigned_to", "user-1"]],
    ]);
  });

  it("applies search as an ilike OR across name/email/business_name", async () => {
    await listLeads({ search: "acme" });
    const q = state.lastQuery!;
    const orCall = q.calls.find(([name]) => name === "or");
    expect(orCall).toBeTruthy();
    const clause = orCall![1][0] as string;
    expect(clause).toContain("first_name.ilike.%acme%");
    expect(clause).toContain("last_name.ilike.%acme%");
    expect(clause).toContain("email.ilike.%acme%");
    expect(clause).toContain("business_name.ilike.%acme%");
  });

  it("ignores a blank/whitespace-only search term", async () => {
    await listLeads({ search: "   " });
    const q = state.lastQuery!;
    expect(q.calls.some(([name]) => name === "or")).toBe(false);
  });
});

// ── createLead ───────────────────────────────────────────────────────────────

const NEW_LEAD_ROW = {
  id: "lead-new",
  org_id: "org-1",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  business_name: "Doe Studio",
  current_stage_id: "stage-first",
  assigned_to: null,
};

function stubCreateTables() {
  state.resultsByTable = {
    crm_stage: { data: { id: "stage-first" }, error: null },
    crm_lead: { data: NEW_LEAD_ROW, error: null },
  };
}

describe("createLead", () => {
  it("refuses social_media and viewer before touching the database", async () => {
    for (const role of ["social_media", "viewer"]) {
      state.role = role;
      state.tables = [];
      await expect(
        createLead({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
      ).rejects.toThrow(/Forbidden/);
      expect(state.tables).toHaveLength(0);
    }
  });

  it("refuses a caller with no resolvable role", async () => {
    state.role = null;
    await expect(
      createLead({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("rejects invalid input with a field message and never inserts", async () => {
    state.role = "intake";
    stubCreateTables();
    await expect(
      createLead({ firstName: "Jane", lastName: "Doe", email: "not-an-email" }),
    ).rejects.toThrow(/valid email/i);
    expect(state.tables).toHaveLength(0);
  });

  it("defaults to the tenant's lowest order_index stage and stamps org_id from current_org_id()", async () => {
    state.role = "intake";
    stubCreateTables();

    const created = await createLead({
      firstName: " Jane ",
      lastName: "Doe",
      email: "  JANE@Example.com ",
      website: "doestudio.com",
    });
    expect((created as { id: string }).id).toBe("lead-new");

    // The default-stage lookup orders by order_index ascending.
    const stageQuery = state.queries[0];
    expect(state.tables[0]).toBe("crm_stage");
    expect(stageQuery.calls.find(([n]) => n === "order")![1]).toEqual([
      "order_index",
      { ascending: true },
    ]);

    const insertCall = state.queries
      .flatMap((q) => q.calls)
      .find(([name]) => name === "insert");
    const payload = insertCall![1][0] as Record<string, unknown>;
    expect(payload.org_id).toBe("org-1");
    expect(payload.current_stage_id).toBe("stage-first");
    // Normalised by the shared pure validator, not stored as typed.
    expect(payload.first_name).toBe("Jane");
    expect(payload.email).toBe("jane@example.com");
    expect(payload.website).toBe("https://doestudio.com/");
  });

  it("uses an explicit stage when one is supplied (no default lookup)", async () => {
    state.role = "attorney";
    stubCreateTables();
    await createLead({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      currentStageId: "stage-chosen",
    });
    expect(state.tables).not.toContain("crm_stage");
    const insertCall = state.queries.flatMap((q) => q.calls).find(([n]) => n === "insert");
    expect((insertCall![1][0] as Record<string, unknown>).current_stage_id).toBe("stage-chosen");
  });

  it("refuses when the firm has no stages yet, with a friendly message", async () => {
    state.role = "attorney";
    state.resultsByTable = { crm_stage: { data: null, error: null } };
    await expect(
      createLead({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    ).rejects.toThrow(/no pipeline stages yet/i);
  });

  it("writes a lead_created audit row AFTER the insert", async () => {
    state.role = "intake";
    stubCreateTables();
    await createLead({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" });

    expect(state.logActivitySafe).toHaveBeenCalledTimes(1);
    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [
      { type: string; leadId: string; payload: Record<string, unknown> },
    ];
    expect(entry.type).toBe("lead_created");
    expect(entry.leadId).toBe("lead-new");
    expect(entry.payload.email).toBe("jane@example.com");
  });

  it("never logs when the insert itself fails", async () => {
    state.role = "intake";
    state.resultsByTable = {
      crm_stage: { data: { id: "stage-first" }, error: null },
      crm_lead: { data: null, error: { message: "boom", code: "23505" } },
    };
    await expect(
      createLead({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" }),
    ).rejects.toBeTruthy();
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });
});

// ── updateLead ───────────────────────────────────────────────────────────────

describe("updateLead", () => {
  it("refuses viewer and social_media", async () => {
    for (const role of ["viewer", "social_media"]) {
      state.role = role;
      await expect(updateLead("lead-1", { email: "new@example.com" })).rejects.toThrow(
        /Forbidden/,
      );
    }
  });

  it("corrects an email, stamps last_activity_at, and logs a field-level diff", async () => {
    state.role = "paralegal"; // paralegals may edit lead data (just not move stages)
    state.resultsByTable = {
      crm_lead: {
        data: {
          id: "lead-1",
          first_name: "Jane",
          last_name: "Doe",
          email: "typo@example.com",
          phone: null,
          business_name: null,
          website: null,
        },
        error: null,
      },
    };

    await updateLead("lead-1", { email: "correct@example.com" });

    const updateCall = state.queries.flatMap((q) => q.calls).find(([n]) => n === "update");
    const payload = updateCall![1][0] as Record<string, unknown>;
    expect(payload.email).toBe("correct@example.com");
    // A partial patch must not blank the columns the form didn't send.
    expect(payload).not.toHaveProperty("first_name");
    expect(typeof payload.last_activity_at).toBe("string");

    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [
      { type: string; payload: { changes: Record<string, { from: string; to: string }> } },
    ];
    expect(entry.type).toBe("lead_updated");
    expect(entry.payload.changes.email).toEqual({
      from: "typo@example.com",
      to: "correct@example.com",
    });
  });

  it("is a no-op — no write, no audit row — when nothing actually changed", async () => {
    state.role = "attorney";
    state.resultsByTable = {
      crm_lead: {
        data: {
          id: "lead-1",
          first_name: "Jane",
          last_name: "Doe",
          email: "jane@example.com",
          phone: null,
          business_name: null,
          website: null,
        },
        error: null,
      },
    };

    await updateLead("lead-1", { email: "  JANE@example.com " });

    expect(state.queries.flatMap((q) => q.calls).some(([n]) => n === "update")).toBe(false);
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });

  it("rejects a blank required field rather than nulling the column", async () => {
    state.role = "attorney";
    await expect(updateLead("lead-1", { firstName: "   " })).rejects.toThrow(/required/i);
  });
});

// ── assignment audit ─────────────────────────────────────────────────────────

describe("assignLead audit", () => {
  it("logs lead_assigned with the previous and new assignee", async () => {
    state.role = "paralegal";
    // The pre-update read reports the lead as unassigned, so "user-9" is a
    // real change and must be recorded.
    state.fromResult = { data: { id: "lead-1", assigned_to: null }, error: null };

    await assignLead("lead-1", "user-9");

    const [entry] = state.logActivitySafe.mock.calls[0] as unknown as [
      { type: string; payload: Record<string, unknown> },
    ];
    expect(entry.type).toBe("lead_assigned");
    expect(entry.payload.to_user_id).toBe("user-9");
  });

  it("does not log when the assignee is unchanged", async () => {
    state.role = "paralegal";
    // Already assigned to user-9; re-submitting the same teammate must not
    // add a timeline row.
    state.fromResult = { data: { id: "lead-1", assigned_to: "user-9" }, error: null };
    await assignLead("lead-1", "user-9");
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });
});

describe("CAN_WRITE_LEAD guard membership", () => {
  it("mirrors the crm_lead_insert_staff / _update_staff RLS role list", () => {
    expect(CAN_WRITE_LEAD).not.toContain("social_media");
    expect(CAN_WRITE_LEAD).not.toContain("viewer");
    for (const role of [
      "owner",
      "admin",
      "senior_admin",
      "intake",
      "paralegal",
      "law_clerk",
      "attorney",
      "clerk",
    ]) {
      expect(CAN_WRITE_LEAD).toContain(role);
    }
  });
});
