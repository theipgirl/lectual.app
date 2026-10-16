import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake Supabase query builder ────────────────────────────────────────────
// Chain methods record their calls and return `this`; the object is itself
// thenable so `await query` resolves regardless of which method was called
// last (mirrors tests/matters/matters.test.ts's FakeQuery). Results are
// looked up per-table (state.byTable) since brain.ts touches two tables in
// one call (crm_claim_library then crm_claim_review_log).
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown; count?: number }) {}
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
  update(...a: unknown[]) {
    this.calls.push(["update", a]);
    return this;
  }
  insert(...a: unknown[]) {
    this.calls.push(["insert", a]);
    return this;
  }
  upsert(...a: unknown[]) {
    this.calls.push(["upsert", a]);
    return this;
  }
  delete(...a: unknown[]) {
    this.calls.push(["delete", a]);
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const state = vi.hoisted(() => ({
  role: "admin" as string | null,
  orgId: "org-1" as string | null,
  callerId: "caller-1" as string | null,
  byTable: {} as Record<string, { data: unknown; error: unknown; count?: number }>,
  queries: [] as Array<{ table: string; query: FakeQuery }>,
}));

const mockFrom = vi.fn((table: string) => {
  const result = state.byTable[table] ?? { data: [] as unknown, error: null as unknown };
  const q = new FakeQuery(result);
  state.queries.push({ table, query: q });
  return q;
});

const mockRpc = vi.fn((fn: string) => {
  if (fn === "current_org_role") return Promise.resolve({ data: state.role, error: null });
  if (fn === "current_org_id") return Promise.resolve({ data: state.orgId, error: null });
  return Promise.resolve({ data: null, error: null });
});

const mockGetUser = vi.fn(() =>
  Promise.resolve({
    data: { user: state.callerId ? { id: state.callerId } : null },
    error: null,
  }),
);

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getUser: mockGetUser },
  })),
}));

const {
  listBrainEntries,
  getBrainEntry,
  createBrainEntry,
  updateBrainEntry,
  deleteBrainEntry,
  requireBrainAdminRole,
  BRAIN_ADMIN_ROLES,
} = await import("@/lib/brain/entries");

const {
  listClaims,
  proposeClaim,
  reviewClaim,
  deleteClaim,
  requireClaimProposeRole,
  requireClaimReviewRole,
  CLAIM_PROPOSE_ROLES,
  CLAIM_REVIEW_ROLES,
  CLAIM_DELETE_ROLES,
} = await import("@/lib/brain/claims");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
  state.orgId = "org-1";
  state.callerId = "caller-1";
  state.byTable = {};
  state.queries = [];
});

function insertPayloadFor(table: string): Record<string, unknown> {
  const entry = [...state.queries]
    .reverse()
    .find((q) => q.table === table && q.query.calls.some(([n]) => n === "insert"));
  if (!entry) throw new Error(`no insert recorded for table ${table}`);
  const call = entry.query.calls.find(([n]) => n === "insert")!;
  return call[1][0] as Record<string, unknown>;
}

function lastPayloadFor(table: string, method: "update"): Record<string, unknown> {
  const entry = [...state.queries]
    .reverse()
    .find((q) => q.table === table && q.query.calls.some(([n]) => n === method));
  if (!entry) throw new Error(`no ${method} recorded for table ${table}`);
  const call = entry.query.calls.find(([n]) => n === method)!;
  return call[1][0] as Record<string, unknown>;
}

// ── Role sets ──────────────────────────────────────────────────────────────

describe("brain role-set constants", () => {
  it("BRAIN_ADMIN_ROLES is owner/admin/senior_admin only", () => {
    expect(BRAIN_ADMIN_ROLES).toEqual(["owner", "admin", "senior_admin"]);
  });

  it("CLAIM_PROPOSE_ROLES is every staff role except viewer", () => {
    expect(CLAIM_PROPOSE_ROLES.sort()).toEqual(
      ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk", "social_media"].sort(),
    );
    expect(CLAIM_PROPOSE_ROLES).not.toContain("viewer");
  });

  it("CLAIM_REVIEW_ROLES is owner/admin/senior_admin/attorney", () => {
    expect(CLAIM_REVIEW_ROLES.sort()).toEqual(["owner", "admin", "senior_admin", "attorney"].sort());
  });

  it("CLAIM_DELETE_ROLES is owner/admin/senior_admin only (narrower than review)", () => {
    expect(CLAIM_DELETE_ROLES.sort()).toEqual(["owner", "admin", "senior_admin"].sort());
    expect(CLAIM_DELETE_ROLES).not.toContain("attorney");
  });
});

// ── Firm-brain entries ───────────────────────────────────────────────────────

describe("brain entry writes are admin-gated", () => {
  it("requireBrainAdminRole rejects intake", async () => {
    state.role = "intake";
    const supabase = { rpc: mockRpc } as never;
    await expect(requireBrainAdminRole(supabase)).rejects.toThrow(/permission/);
  });

  it("createBrainEntry rejects a non-admin role without touching the DB", async () => {
    state.role = "paralegal";
    await expect(
      createBrainEntry({ category: "voice", key: "tone", title: "Tone" }),
    ).rejects.toThrow(/permission/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("createBrainEntry allows admin, stamps org_id from current_org_id() and created_by from the session", async () => {
    state.role = "admin";
    state.orgId = "org-1";
    state.callerId = "caller-1";
    state.byTable["crm_firm_brain_entry"] = { data: { id: "b-1" }, error: null };
    await expect(
      createBrainEntry({ category: "pricing", key: "flat-fee", title: "Flat fee schedule" }),
    ).resolves.toMatchObject({ id: "b-1" });
    const payload = insertPayloadFor("crm_firm_brain_entry");
    expect(payload.org_id).toBe("org-1");
    expect(payload.created_by).toBe("caller-1");
    expect(payload.status).toBeUndefined();
  });

  it("updateBrainEntry never writes org_id and always bumps updated_at", async () => {
    state.role = "senior_admin";
    state.byTable["crm_firm_brain_entry"] = { data: { id: "b-1" }, error: null };
    await updateBrainEntry("b-1", { title: "New title" });
    const payload = lastPayloadFor("crm_firm_brain_entry", "update");
    expect(payload).not.toHaveProperty("org_id");
    expect(payload.title).toBe("New title");
    expect(payload.updated_at).toBeTruthy();
  });

  it("deleteBrainEntry rejects viewer", async () => {
    state.role = "viewer";
    await expect(deleteBrainEntry("b-1")).rejects.toThrow(/permission/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("listBrainEntries / getBrainEntry are readable by any role (not gated)", async () => {
    state.role = "viewer";
    state.byTable["crm_firm_brain_entry"] = { data: [{ id: "b-1" }], error: null };
    await expect(listBrainEntries()).resolves.toHaveLength(1);
    state.byTable["crm_firm_brain_entry"] = { data: { id: "b-1" }, error: null };
    await expect(getBrainEntry("b-1")).resolves.toMatchObject({ id: "b-1" });
  });
});

// ── Claim library ─────────────────────────────────────────────────────────

describe("claim propose gate", () => {
  it("requireClaimReviewRole throws for intake", async () => {
    state.role = "intake";
    const supabase = { rpc: mockRpc } as never;
    await expect(requireClaimReviewRole(supabase)).rejects.toThrow(/permission/);
  });

  it("requireClaimProposeRole allows social_media but throws for viewer", async () => {
    const supabase = { rpc: mockRpc } as never;
    state.role = "social_media";
    await expect(requireClaimProposeRole(supabase)).resolves.toBe("social_media");
    state.role = "viewer";
    await expect(requireClaimProposeRole(supabase)).rejects.toThrow(/permission/);
  });

  it("proposeClaim is allowed for social_media", async () => {
    state.role = "social_media";
    state.byTable["crm_claim_library"] = { data: { id: "c-1", status: "proposed" }, error: null };
    await expect(proposeClaim({ claim: "Fast filings" })).resolves.toMatchObject({ id: "c-1" });
  });

  it("proposeClaim rejects viewer without touching the DB", async () => {
    state.role = "viewer";
    await expect(proposeClaim({ claim: "Guaranteed win" })).rejects.toThrow(/permission/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("proposeClaim ALWAYS forces status='proposed', even if a caller tries otherwise", async () => {
    state.role = "intake";
    state.byTable["crm_claim_library"] = { data: { id: "c-2", status: "proposed" }, error: null };
    // The public ProposeClaimInput type has no `status` field at all, so we
    // smuggle one in via an unsound cast to prove the function ignores it.
    await proposeClaim({ claim: "Best in class", status: "approved" } as never);
    const payload = insertPayloadFor("crm_claim_library");
    expect(payload.status).toBe("proposed");
  });

  it("proposeClaim stamps org_id from current_org_id() and created_by from the session, never from input", async () => {
    state.role = "paralegal";
    state.orgId = "org-9";
    state.callerId = "caller-9";
    state.byTable["crm_claim_library"] = { data: { id: "c-3" }, error: null };
    await proposeClaim({ claim: "X" });
    const payload = insertPayloadFor("crm_claim_library");
    expect(payload.org_id).toBe("org-9");
    expect(payload.created_by).toBe("caller-9");
  });
});

describe("claim review gate", () => {
  it("reviewClaim rejects intake outright", async () => {
    state.role = "intake";
    await expect(reviewClaim("c-1", "approved")).rejects.toThrow(/permission/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reviewClaim allows attorney (review role beyond plain admin set)", async () => {
    state.role = "attorney";
    state.callerId = "atty-1";
    state.byTable["crm_claim_library"] = { data: { id: "c-1", status: "approved" }, error: null };
    await expect(reviewClaim("c-1", "approved", "checked against Bar rules")).resolves.toMatchObject({
      id: "c-1",
    });
  });

  it("reviewClaim sources reviewed_by from the mocked session, never from a parameter", async () => {
    state.role = "admin";
    state.callerId = "reviewer-42";
    state.byTable["crm_claim_library"] = { data: { id: "c-1" }, error: null };
    // reviewClaim's signature has no reviewed_by parameter at all — this
    // proves the value written comes only from auth.getUser().
    await reviewClaim("c-1", "forbidden", "not allowed under 4-7.22");
    const payload = lastPayloadFor("crm_claim_library", "update");
    expect(payload.reviewed_by).toBe("reviewer-42");
    expect(payload.status).toBe("forbidden");
    expect(payload.notes).toBe("not allowed under 4-7.22");
    expect(payload.reviewed_at).toBeTruthy();
    expect(payload.updated_at).toBeTruthy();
  });

  it("reviewClaim appends an immutable audit row with org_id from the claim, not input", async () => {
    state.role = "senior_admin";
    state.callerId = "reviewer-9";
    // The updated claim row carries the RLS-scoped org_id the log must inherit.
    state.byTable["crm_claim_library"] = {
      data: { id: "c-7", org_id: "org-real", status: "approved" },
      error: null,
    };
    await reviewClaim("c-7", "approved", "cleared under 4-7.14");
    const log = insertPayloadFor("crm_claim_review_log");
    expect(log.claim_id).toBe("c-7");
    expect(log.org_id).toBe("org-real"); // from the claim row, never from the caller
    expect(log.status).toBe("approved");
    expect(log.notes).toBe("cleared under 4-7.14");
    expect(log.reviewed_by).toBe("reviewer-9"); // from the session
  });

  it("reviewClaim fails closed when the audit-log insert errors", async () => {
    state.role = "admin";
    state.callerId = "reviewer-1";
    state.byTable["crm_claim_library"] = { data: { id: "c-1", org_id: "org-1" }, error: null };
    state.byTable["crm_claim_review_log"] = { data: null, error: { message: "log write failed" } };
    await expect(reviewClaim("c-1", "forbidden")).rejects.toThrow(/log write failed/);
  });

  it("deleteClaim rejects attorney (delete is narrower than review)", async () => {
    state.role = "attorney";
    await expect(deleteClaim("c-1")).rejects.toThrow(/permission/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("deleteClaim allows owner", async () => {
    state.role = "owner";
    state.byTable["crm_claim_library"] = { data: null, error: null };
    await expect(deleteClaim("c-1")).resolves.toBeUndefined();
  });

  it("listClaims is readable by any role (not gated)", async () => {
    state.role = "viewer";
    state.byTable["crm_claim_library"] = { data: [{ id: "c-1", status: "proposed" }], error: null };
    await expect(listClaims()).resolves.toHaveLength(1);
  });
});
